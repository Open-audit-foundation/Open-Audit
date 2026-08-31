/**
 * Secure XDR/ScVal Parser with Security Hardening
 *
 * This module wraps the existing XDR parsing logic with comprehensive
 * security guards to protect against malicious payloads.
 *
 * All parsing operations enforce:
 * - Recursion depth limits
 * - Memory allocation guards
 * - Parsing time limits
 * - Collection size limits
 * - Graceful error handling
 */

import { xdr as StellarXdr } from "stellar-sdk";
import {
  createParsingContext,
  enterLevel,
  checkTimeout,
  trackAllocation,
  validateCollectionSize,
  validateHexLength,
  safeParseXdr,
  logSecurityError,
  recordParse,
  toSafeErrorMessage,
  MaxDepthExceededError,
  MaxPayloadSizeExceededError,
  MaxParseTimeExceededError,
  MaxCollectionSizeExceededError,
  MaxHexLengthExceededError,
  MalformedXdrError,
  type ParserSecurityError,
  type ParsingContext,
  type SafeParseResult,
} from "./parser-security";
import { truncateHex } from "./decode";
import {
  getNativeXdrDecoder,
  type NativeDecodeOutcome,
  type NativeXdrDecoder,
} from "./native-xdr-decoder";

// ============================================================================
// Secure ScVal Parsing
// ============================================================================

/**
 * Safely parses a hex-encoded ScVal with security guards.
 * Returns a SafeParseResult that never throws.
 *
 * When the native decoder (native/soroban-xdr-decode) is built and loadable,
 * the parse+validation work is delegated to it; otherwise (or if it fails in
 * any way at runtime) this transparently uses the pure-TypeScript
 * implementation. Both paths enforce the exact same security guards and
 * produce identical results — see native-ts-parity.test.ts.
 *
 * @param hex Hex-encoded ScVal (with or without 0x prefix)
 * @returns SafeParseResult with either the parsed ScVal or security error
 */
/**
 * Below this input size the pure-TS path outruns the native one: the N-API
 * call overhead exceeds the validation work saved (crossover measured at
 * ~100 hex chars on Node 20/linux-x64 — see scripts/bench-xdr-parser.ts).
 * Both paths enforce identical guards, so this is purely a speed heuristic.
 */
const NATIVE_MIN_HEX_CHARS = 96;

export function secureParseScVal(hex: string): SafeParseResult<StellarXdr.ScVal> {
  if (typeof hex === "string" && hex.length >= NATIVE_MIN_HEX_CHARS) {
    const native = getNativeXdrDecoder();
    if (native) {
      const result = nativeParseScVal(native, hex);
      if (result) {
        return finishParseResult(result, hex);
      }
      // Native addon unhealthy for this input — fall through to TS.
    }
  }
  return secureParseScValTs(hex);
}

/**
 * Pure-TypeScript implementation of secureParseScVal. Exported so the parity
 * test suite and benchmarks can compare it against the native path; regular
 * callers should use secureParseScVal, which picks the best available path.
 */
export function secureParseScValTs(hex: string): SafeParseResult<StellarXdr.ScVal> {
  const result = safeParseXdr<StellarXdr.ScVal>((ctx) => {
    // Validate hex length first
    validateHexLength(hex);
    
    // Track allocation for the hex string
    const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex;
    const estimatedBytes = cleanHex.length / 2; // 2 hex chars = 1 byte
    const updatedCtx = trackAllocation(ctx, estimatedBytes);
    
    // Parse the XDR
    const scVal = StellarXdr.ScVal.fromXDR(cleanHex, "hex");
    
    // Recursively validate the parsed structure
    validateScValStructure(scVal, updatedCtx);
    
    return scVal;
  });

  return finishParseResult(result, hex);
}

/**
 * Shared metrics/logging tail for both the native and TS parse paths, so the
 * observable side effects are identical regardless of which path ran.
 */
function finishParseResult(
  result: SafeParseResult<StellarXdr.ScVal>,
  hex: string
): SafeParseResult<StellarXdr.ScVal> {
  // Record metrics
  recordParse(result.success, result.success ? createParsingContext() : createParsingContext(), result.error ?? undefined);

  // Log security errors
  if (!result.success) {
    logSecurityError(result.error, { hex: truncateHex(hex) });
  }

  return result;
}

/**
 * Runs the native decoder for one input. Returns null whenever the TypeScript
 * implementation should take over instead (native threw, returned a
 * malformed outcome, or disagreed with the JS XDR parser on a success).
 */
function nativeParseScVal(
  native: NativeXdrDecoder,
  hex: string
): SafeParseResult<StellarXdr.ScVal> | null {
  let outcome: NativeDecodeOutcome;
  try {
    outcome = native.decodeScVal(hex);
  } catch {
    // Includes non-string inputs (N-API type errors) and addon crashes that
    // surface as exceptions — the TS path classifies those itself.
    return null;
  }

  if (!outcome || typeof outcome.success !== "boolean") {
    return null;
  }

  if (outcome.success) {
    try {
      const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex;
      const scVal = StellarXdr.ScVal.fromXDR(cleanHex, "hex");
      return { success: true, value: scVal, error: null };
    } catch {
      // The native decoder accepted a payload the JS parser rejects — treat
      // the native module as untrustworthy for this input and let the TS
      // implementation produce the authoritative result.
      return null;
    }
  }

  const error = nativeOutcomeToError(outcome);
  if (!error) {
    return null;
  }
  return { success: false, value: null, error };
}

/**
 * Reconstructs the exact ParserSecurityError subclass the TS implementation
 * would have thrown, from the native outcome's errorType and parameters, so
 * error messages match the TS path verbatim.
 */
function nativeOutcomeToError(
  outcome: NativeDecodeOutcome
): ParserSecurityError | null {
  const actual = outcome.actual ?? 0;
  const limit = outcome.limit ?? 0;
  switch (outcome.errorType) {
    case "MAX_DEPTH_EXCEEDED":
      return new MaxDepthExceededError(actual, limit);
    case "MAX_PAYLOAD_SIZE_EXCEEDED":
      return new MaxPayloadSizeExceededError(actual, limit);
    case "MAX_PARSE_TIME_EXCEEDED":
      return new MaxParseTimeExceededError(actual, limit);
    case "MAX_COLLECTION_SIZE_EXCEEDED":
      return new MaxCollectionSizeExceededError(actual, limit);
    case "MAX_HEX_LENGTH_EXCEEDED":
      return new MaxHexLengthExceededError(actual, limit);
    case "MALFORMED_XDR":
      return new MalformedXdrError(outcome.message ?? "unknown parse error");
    default:
      // Unknown classification from the addon — distrust it and fall back.
      return null;
  }
}

/**
 * Recursively validates an ScVal structure to ensure it doesn't exceed limits.
 * Throws security errors if limits are exceeded.
 *
 * This performs a deep traversal to check:
 * - Recursion depth
 * - Collection sizes
 * - Parse timeouts
 */
function validateScValStructure(
  scVal: StellarXdr.ScVal,
  ctx: ParsingContext
): void {
  // Check timeout on each validation step
  checkTimeout(ctx);
  
  const kind = scVal.switch().name;
  
  switch (kind) {
    case "scvMap": {
      const entries = scVal.map() ?? [];
      validateCollectionSize(entries.length);
      
      // Track memory allocation for the map
      const mapBytes = entries.length * 100; // Rough estimate: 100 bytes per entry
      const updatedCtx = trackAllocation(ctx, mapBytes);
      
      // Recursively validate each entry
      const childCtx = enterLevel(updatedCtx);
      for (const entry of entries) {
        validateScValStructure(entry.key(), childCtx);
        validateScValStructure(entry.val(), childCtx);
      }
      break;
    }
    
    case "scvVec": {
      const items = scVal.vec() ?? [];
      validateCollectionSize(items.length);
      
      // Track memory allocation for the vector
      const vecBytes = items.length * 50; // Rough estimate: 50 bytes per item
      const updatedCtx = trackAllocation(ctx, vecBytes);
      
      // Recursively validate each item
      const childCtx = enterLevel(updatedCtx);
      for (const item of items) {
        validateScValStructure(item, childCtx);
      }
      break;
    }
    
    case "scvBytes": {
      const bytes = scVal.bytes();
      const byteLength = bytes.length;
      trackAllocation(ctx, byteLength);
      break;
    }
    
    case "scvString": {
      const str = scVal.str();
      const strLength = Buffer.byteLength(str.toString(), "utf8");
      trackAllocation(ctx, strLength);
      break;
    }
    
    // Primitive types don't need recursive validation
    default:
      // Track small allocation for primitive
      trackAllocation(ctx, 8);
      break;
  }
}

// ============================================================================
// Secure ScVal to String Conversion
// ============================================================================

/**
 * Result of converting an ScVal to a human-readable string.
 */
export type ScValStringResult =
  | { success: true; value: string; error: null }
  | { success: false; value: string; error: Error };

/**
 * Safely converts an ScVal to a human-readable string with security guards.
 * Returns a fallback string if parsing fails.
 *
 * @param scVal The ScVal to convert
 * @param typeMap Optional type map for UDT resolution
 * @returns ScValStringResult with either the string or fallback
 */
export function secureScValToString(
  scVal: StellarXdr.ScVal,
  typeMap: unknown = null
): ScValStringResult {
  const result = safeParseXdr<string>((ctx) => {
    return scValToStringInternal(scVal, ctx);
  });
  
  if (result.success) {
    return { success: true, value: result.value, error: null };
  }
  
  // Return safe fallback on error
  const fallback = toSafeErrorMessage(result.error);
  logSecurityError(result.error, { scVal: "ScVal object" });
  
  return {
    success: false,
    value: fallback,
    error: result.error,
  };
}

/**
 * Internal recursive converter with depth tracking.
 */
function scValToStringInternal(
  scVal: StellarXdr.ScVal,
  ctx: ParsingContext
): string {
  // Check timeout on each recursion
  checkTimeout(ctx);
  
  const kind = scVal.switch().name;
  
  switch (kind) {
    case "scvBool":
      return String(scVal.b());
    
    case "scvU32":
      return String(scVal.u32());
    
    case "scvI32":
      return String(scVal.i32());
    
    case "scvU64":
      return scVal.u64().toString();
    
    case "scvI64":
      return scVal.i64().toString();
    
    case "scvU128": {
      const u = scVal.u128();
      return (
        (BigInt(u.hi().toString()) << BigInt(64)) |
        BigInt(u.lo().toString())
      ).toString();
    }
    
    case "scvI128": {
      const i = scVal.i128();
      return (
        (BigInt(i.hi().toString()) << BigInt(64)) |
        BigInt(i.lo().toString())
      ).toString();
    }
    
    case "scvSymbol":
      return scVal.sym().toString();
    
    case "scvString":
      return scVal.str().toString();
    
    case "scvBytes":
      return "0x" + scVal.bytes().toString("hex").slice(0, 16) + "…";
    
    case "scvAddress":
      return formatScAddressSafe(scVal.address());
    
    case "scvMap": {
      const entries = scVal.map() ?? [];
      validateCollectionSize(entries.length);
      
      const childCtx = enterLevel(ctx);
      const parts = entries.map((entry: StellarXdr.ScMapEntry): string => {
        const k = scValToStringInternal(entry.key(), childCtx);
        const v = scValToStringInternal(entry.val(), childCtx);
        return `${k}: ${v}`;
      });
      
      return `{${parts.join(", ")}}`;
    }
    
    case "scvVec": {
      const items = scVal.vec() ?? [];
      validateCollectionSize(items.length);
      
      const childCtx = enterLevel(ctx);
      const parts = items.map((v: StellarXdr.ScVal): string => {
        return scValToStringInternal(v, childCtx);
      });
      
      return `[${parts.join(", ")}]`;
    }
    
    default:
      return truncateHex(scVal.toXDR("hex"));
  }
}

/**
 * Safely formats an ScAddress to a Stellar address string.
 * Returns a safe fallback on error.
 */
function formatScAddressSafe(address: StellarXdr.ScAddress): string {
  try {
    const { StrKey } = require("stellar-sdk");
    const kind = address.switch().name;
    
    if (kind === "scAddressTypeAccount") {
      const accountId = address.accountId();
      const rawKey = accountId.ed25519();
      return StrKey.encodeEd25519PublicKey(rawKey);
    }
    
    if (kind === "scAddressTypeContract") {
      return StrKey.encodeContract(address.contractId());
    }
    
    return "unknown-address";
  } catch {
    return "invalid-address";
  }
}

// ============================================================================
// Secure Event Payload Decoding
// ============================================================================

/**
 * Safely decodes an array of hex-encoded ScVals.
 * Returns human-readable strings with safe fallbacks for errors.
 *
 * @param scValHexes Array of hex-encoded ScVal strings
 * @returns Array of human-readable strings (never throws)
 */
export function secureDecodeEventPayload(scValHexes: string[]): string[] {
  return scValHexes.map((hex: string): string => {
    const parseResult = secureParseScVal(hex);
    
    if (!parseResult.success) {
      // Return safe error message instead of hex
      return toSafeErrorMessage(parseResult.error);
    }
    
    const stringResult = secureScValToString(parseResult.value);
    return stringResult.value;
  });
}

// ============================================================================
// Secure ScSpec Entry Parsing
// ============================================================================

/**
 * Safely parses an array of ScSpecEntry from a WASM payload.
 * Returns a SafeParseResult that never throws.
 *
 * @param payload Raw XDR bytes from WASM contractSpecV0 section
 * @returns SafeParseResult with array of ScSpecEntry or error
 */
export function secureParseSpecEntries(
  payload: Uint8Array
): SafeParseResult<StellarXdr.ScSpecEntry[]> {
  const result = safeParseXdr<StellarXdr.ScSpecEntry[]>((ctx) => {
    // Validate payload size
    const updatedCtx = trackAllocation(ctx, payload.length);
    
    const entries: StellarXdr.ScSpecEntry[] = [];
    let offset = 0;
    
    while (offset < payload.length) {
      // Check timeout on each entry
      checkTimeout(updatedCtx);
      
      // Validate we have at least 4 bytes for length
      if (offset + 4 > payload.length) {
        break; // Truncated payload, stop parsing
      }
      
      // Read entry length (4-byte big-endian)
      const len = new DataView(
        payload.buffer,
        payload.byteOffset + offset,
        4
      ).getUint32(0, false);
      
      offset += 4;
      
      // Validate entry length is reasonable
      if (len > 1024 * 1024) {
        // Individual entry > 1MB is suspicious
        throw new Error(`ScSpecEntry length too large: ${len} bytes`);
      }
      
      // Validate we have enough bytes for the entry
      if (offset + len > payload.length) {
        break; // Truncated entry, stop parsing
      }
      
      const entryBytes = payload.subarray(offset, offset + len);
      offset += len;
      
      try {
        const entry = StellarXdr.ScSpecEntry.fromXDR(Buffer.from(entryBytes));
        entries.push(entry);
      } catch {
        // Skip malformed entries — parse as many as we can
        continue;
      }
      
      // Check we haven't exceeded collection size
      validateCollectionSize(entries.length);
    }
    
    return entries;
  });
  
  // Record metrics
  recordParse(result.success, createParsingContext(), result.error ?? undefined);
  
  // Log security errors
  if (!result.success) {
    logSecurityError(result.error, { payloadSize: payload.length });
  }
  
  return result;
}

// ============================================================================
// Export All Security Functions
// ============================================================================

export {
  // Security configuration
  MAX_RECURSION_DEPTH,
  MAX_PAYLOAD_SIZE_BYTES,
  MAX_PARSE_TIME_MS,
  MAX_COLLECTION_SIZE,
  MAX_HEX_STRING_LENGTH,
  
  // Error classes
  ParserSecurityError,
  MaxDepthExceededError,
  MaxPayloadSizeExceededError,
  MaxParseTimeExceededError,
  MaxCollectionSizeExceededError,
  MaxHexLengthExceededError,
  MalformedXdrError,
  
  // Security utilities
  createParsingContext,
  safeParseXdr,
  logSecurityError,
  toSafeErrorMessage,
  
  // Metrics
  getSecurityMetrics,
  resetSecurityMetrics,
  detectAttackPattern,
} from "./parser-security";
