/**
 * Generic Fallback XDR Decoder for Unregistered Contracts
 *
 * When a contract is not found in the Translation Registry, this module
 * attempts to parse basic Soroban XDR types (Bool, U32, I32, String) from the
 * raw event payload and render them as a generic JSON structure.
 *
 * This provides a better user experience than showing an empty row or opaque
 * hex string when viewing events from newly deployed contracts.
 *
 * Supported types:
 *  - Bool (scvBool)
 *  - U32 (scvU32)
 *  - I32 (scvI32)
 *  - String (scvString)
 *  - Symbol (scvSymbol)
 *  - Bytes (scvBytes) — shown as hex
 *  - Vec (scvVec) — array of decoded values
 *  - Map (scvMap) — object of key-value pairs
 *
 * For unsupported types or decoding failures, falls back gracefully to
 * truncated hex representation.
 */

import { getTranslation } from "./translations";
import type { Language, RawEvent } from "./types";

/** A generic decoded value from a fallback decode operation. */
export interface GenericDecodedValue {
  type: string; // e.g., "Bool", "U32", "String", "Vec", "Map"
  value: unknown; // The decoded value (boolean, number, string, object, array, etc.)
  hex?: string; // Original hex for debugging, only included when needed
}

/**
 * Attempts to decode a raw event's payload using generic Soroban XDR parsing.
 * Returns a generic JSON structure suitable for display when no blueprint exists.
 *
 * @param event The raw event to decode
 * @param lang The locale used for any embedded fallback strings (e.g. invalid UTF-8 markers)
 * @returns A human-readable JSON structure or null if decoding completely fails
 */
export function decodeGenericEventPayload(event: RawEvent, lang: Language = "en"): unknown {
  try {
    // Try to decode the main data field as ScVal
    if (!event.data) {
      return { type: "unknown", hex: event.data };
    }

    const decoded = decodeScValFromHex(event.data, lang);
    if (decoded) {
      return decoded;
    }

    // Fallback: return the raw hex
    return {
      type: "bytes",
      value: truncateHexForDisplay(event.data),
      hex: event.data,
    };
  } catch (err) {
    console.warn(
      `[open-audit:generic-fallback-decoder] Failed to decode event ${event.id}:`,
      (err as Error).message
    );
    // Return hex fallback on any error
    return {
      type: "bytes",
      value: truncateHexForDisplay(event.data),
      hex: event.data,
    };
  }
}

/**
 * Attempts to decode a hex-encoded ScVal into a generic structure.
 * Handles basic types and gracefully falls back to hex for unsupported types.
 */
export function decodeScValFromHex(hex: string, lang: Language = "en"): GenericDecodedValue | null {
  if (!hex) return null;

  try {
    const clean = normalizeHex(hex);
    if (!clean) return null;

    // Parse the type discriminant (first 4 bytes = 8 hex chars)
    const typeDiscriminant = parseInt(clean.slice(0, 8), 16);

    switch (typeDiscriminant) {
      case 0: // scvBool
        return decodeBool(clean);
      case 1: // scvVoid
        return { type: "void", value: null };
      case 2: // scvError
        return decodeError(clean);
      case 3: // scvU32
        return decodeU32(clean);
      case 4: // scvI32
        return decodeI32(clean);
      case 5: // scvU64
        return decodeU64(clean);
      case 6: // scvI64
        return decodeI64(clean);
      case 7: // scvTimepoint
        return decodeU64(clean); // Timepoint is u64
      case 8: // scvDuration
        return decodeU64(clean); // Duration is u64
      case 9: // scvU128
        return decodeU128(clean);
      case 10: // scvI128
        return decodeI128(clean);
      case 11: // scvU256
        return decodeU256(clean);
      case 12: // scvI256
        return decodeI256(clean);
      case 13: // scvBytes
        return decodeBytes(clean);
      case 14: // scvString
        return decodeString(clean, lang);
      case 15: // scvSymbol
        return decodeSymbol(clean, lang);
      case 16: // scvVec
        return decodeVec(clean, lang);
      case 17: // scvMap
        return decodeMap(clean, lang);
      case 18: // scvAddress
        return decodeAddress(clean, lang);
      default:
        // Unknown type — return hex
        return {
          type: "unknown",
          value: truncateHexForDisplay(hex),
          hex,
        };
    }
  } catch (err) {
    console.warn(
      `[open-audit:generic-fallback-decoder] Decode error: ${(err as Error).message}`
    );
    return {
      type: "unknown",
      value: truncateHexForDisplay(hex),
      hex,
    };
  }
}

// ─── Type Decoders ───────────────────────────────────────────────────────────

/** Decodes a bool (type 0): 4-byte discriminant + 4-byte padding + 1-byte value. */
function decodeBool(clean: string): GenericDecodedValue {
  const valueHex = clean.slice(16, 18);
  const value = parseInt(valueHex, 16) !== 0;
  return { type: "bool", value };
}

/** Decodes an error. */
function decodeError(clean: string): GenericDecodedValue {
  const codeHex = clean.slice(8, 16);
  const code = parseInt(codeHex, 16);
  return { type: "error", value: code };
}

/** Decodes a U32 (type 3): 4-byte discriminant + 4-byte value. */
function decodeU32(clean: string): GenericDecodedValue {
  const valueHex = clean.slice(8, 16);
  const value = parseInt(valueHex, 16);
  return { type: "u32", value };
}

/** Decodes an I32 (type 4): 4-byte discriminant + 4-byte value. */
function decodeI32(clean: string): GenericDecodedValue {
  const valueHex = clean.slice(8, 16);
  const value = parseInt(valueHex, 16);
  // Check if it's negative (two's complement)
  const signed = value < 0x80000000 ? value : value - 0x100000000;
  return { type: "i32", value: signed };
}

/** Decodes a U64 (type 5): 4-byte discriminant + 8-byte value. */
function decodeU64(clean: string): GenericDecodedValue {
  const valueHex = clean.slice(8, 24);
  const value = BigInt("0x" + valueHex);
  return { type: "u64", value: value.toString() };
}

/** Decodes an I64 (type 6): 4-byte discriminant + 8-byte value. */
function decodeI64(clean: string): GenericDecodedValue {
  const valueHex = clean.slice(8, 24);
  const value = BigInt("0x" + valueHex);
  // Check if negative (two's complement for 64-bit)
  const maxU64 = BigInt("0xFFFFFFFFFFFFFFFF");
  const signed = value > maxU64 >> BigInt(1) ? value - (maxU64 + BigInt(1)) : value;
  return { type: "i64", value: signed.toString() };
}

/** Decodes a U128 (type 9). */
function decodeU128(clean: string): GenericDecodedValue {
  const valueHex = clean.slice(8, 40); // 32 hex chars = 128 bits
  const value = BigInt("0x" + valueHex);
  return { type: "u128", value: value.toString() };
}

/** Decodes an I128 (type 10). */
function decodeI128(clean: string): GenericDecodedValue {
  const valueHex = clean.slice(8, 40);
  const value = BigInt("0x" + valueHex);
  const maxI128 = BigInt("0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF");
  const signed = value > maxI128 ? value - (BigInt(1) << BigInt(128)) : value;
  return { type: "i128", value: signed.toString() };
}

/** Decodes a U256 (type 11). */
function decodeU256(clean: string): GenericDecodedValue {
  const valueHex = clean.slice(8, 72); // 64 hex chars = 256 bits
  const value = BigInt("0x" + valueHex);
  return { type: "u256", value: value.toString() };
}

/** Decodes an I256 (type 12). */
function decodeI256(clean: string): GenericDecodedValue {
  const valueHex = clean.slice(8, 72);
  const value = BigInt("0x" + valueHex);
  const maxI256 = BigInt("0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF");
  const signed = value > maxI256 ? value - (BigInt(1) << BigInt(256)) : value;
  return { type: "i256", value: signed.toString() };
}

/** Decodes bytes (type 13): discriminant + length (4 bytes) + data. */
function decodeBytes(clean: string): GenericDecodedValue {
  const lengthHex = clean.slice(8, 16);
  const length = parseInt(lengthHex, 16);
  const dataStart = 16;
  const dataEnd = Math.min(dataStart + length * 2, clean.length);
  const data = clean.slice(dataStart, dataEnd);
  return {
    type: "bytes",
    value: data.length > 32 ? data.slice(0, 32) + "…" : data,
    hex: "0x" + data,
  };
}

/** Decodes a string (type 14): discriminant + length (4 bytes) + UTF-8 data. */
function decodeString(clean: string, lang: Language = "en"): GenericDecodedValue {
  const t = getTranslation(lang);
  const lengthHex = clean.slice(8, 16);
  const length = parseInt(lengthHex, 16);
  const dataStart = 16;
  const dataEnd = dataStart + length * 2; // 2 hex chars per byte
  if (dataEnd > clean.length) {
    return {
      type: "string",
      value: t.generic.invalidStringLength,
    };
  }
  const data = clean.slice(dataStart, dataEnd);
  try {
    const str = Buffer.from(data, "hex").toString("utf-8");
    // Return the decoded string, limited to 512 chars for display
    return {
      type: "string",
      value: str.slice(0, 512),
    };
  } catch {
    return {
      type: "string",
      value: t.generic.invalidUtf8,
      hex: "0x" + data,
    };
  }
}

/** Decodes a symbol (type 15): similar to string but for Soroban symbols. */
function decodeSymbol(clean: string, lang: Language = "en"): GenericDecodedValue {
  const t = getTranslation(lang);
  const lengthHex = clean.slice(8, 16);
  const length = parseInt(lengthHex, 16);
  const dataStart = 16;
  const dataEnd = dataStart + length * 2;
  if (dataEnd > clean.length) {
    return {
      type: "symbol",
      value: t.generic.invalidSymbolLength,
    };
  }
  const data = clean.slice(dataStart, dataEnd);
  try {
    const str = Buffer.from(data, "hex").toString("utf-8");
    return {
      type: "symbol",
      value: str,
    };
  } catch {
    return {
      type: "symbol",
      value: t.generic.invalidUtf8,
      hex: "0x" + data,
    };
  }
}

/** Decodes a Vec (type 16): discriminant + length (4 bytes) + elements. */
function decodeVec(clean: string, lang: Language = "en"): GenericDecodedValue {
  const lengthHex = clean.slice(8, 16);
  const length = parseInt(lengthHex, 16);

  if (length === 0) {
    return { type: "vec", value: [] };
  }

  const elements: unknown[] = [];
  let offset = 16;

  for (let i = 0; i < length && offset < clean.length; i++) {
    try {
      const remaining = clean.slice(offset);
      const decoded = decodeScValFromHex(remaining, lang);
      if (decoded) {
        elements.push(decoded.value);
        // Estimate next offset (this is approximate)
        offset += 8; // Move past discriminant at minimum
      }
    } catch {
      // Skip this element on error
      offset += 8;
    }
  }

  return { type: "vec", value: elements };
}

/** Decodes a Map (type 17): discriminant + length (4 bytes) + key-value pairs. */
function decodeMap(clean: string, lang: Language = "en"): GenericDecodedValue {
  const lengthHex = clean.slice(8, 16);
  const length = parseInt(lengthHex, 16);

  if (length === 0) {
    return { type: "map", value: {} };
  }

  const entries: Record<string, unknown> = {};
  let offset = 16;

  for (let i = 0; i < length && offset < clean.length; i++) {
    try {
      // Decode key
      const keyRemaining = clean.slice(offset);
      const keyDecoded = decodeScValFromHex(keyRemaining, lang);
      if (!keyDecoded) break;
      const key = String(keyDecoded.value || `key_${i}`);
      offset += 8;

      // Decode value
      const valueRemaining = clean.slice(offset);
      const valueDecoded = decodeScValFromHex(valueRemaining, lang);
      if (valueDecoded) {
        entries[key] = valueDecoded.value;
        offset += 8;
      }
    } catch {
      break;
    }
  }

  return { type: "map", value: entries };
}

/** Decodes an address (type 18): discriminant + address discriminant + key data. */
function decodeAddress(clean: string, lang: Language = "en"): GenericDecodedValue {
  const t = getTranslation(lang);
  const addressTypeHex = clean.slice(8, 16);
  const addressType = parseInt(addressTypeHex, 16);

  if (addressType === 0) {
    // ScAddressTypeAccount: ed25519 public key
    const keyStart = 16;
    const keyEnd = keyStart + 64; // 32 bytes = 64 hex chars
    if (keyEnd <= clean.length) {
      const pubkeyHex = clean.slice(keyStart, keyEnd);
      return {
        type: "address",
        value: `G${pubkeyHex.slice(0, 8)}...${pubkeyHex.slice(-8)}`,
        hex: "0x" + pubkeyHex,
      };
    }
  } else if (addressType === 1) {
    // ScAddressTypeContract: contract ID
    const idStart = 16;
    const idEnd = idStart + 64; // 32 bytes = 64 hex chars
    if (idEnd <= clean.length) {
      const contractHex = clean.slice(idStart, idEnd);
      return {
        type: "address",
        value: `C${contractHex.slice(0, 8)}...${contractHex.slice(-8)}`,
        hex: "0x" + contractHex,
      };
    }
  }

  return {
    type: "address",
    value: t.generic.unknownAddress,
  };
}

// ─── Utilities ───────────────────────────────────────────────────────────────

/** Normalizes a hex string by removing the '0x' prefix and converting to lowercase. */
function normalizeHex(hex: string): string {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  return clean.toLowerCase();
}

/** Truncates a hex string for display (first 16 + '...' + last 8 chars). */
function truncateHexForDisplay(hex: string, maxChars: number = 24): string {
  if (hex.length <= maxChars + 3) return hex;
  return `${hex.slice(0, maxChars)}…${hex.slice(-8)}`;
}

/**
 * Converts a generic decoded value to a human-readable description string.
 * Used when formatting the fallback event description.
 */
export function formatGenericValue(decoded: unknown, indent: number = 0): string {
  if (decoded === null || decoded === undefined) {
    return "null";
  }

  if (typeof decoded === "boolean") {
    return String(decoded);
  }

  if (typeof decoded === "number") {
    return String(decoded);
  }

  if (typeof decoded === "string") {
    return decoded.length > 100 ? decoded.slice(0, 100) + "…" : decoded;
  }

  if (Array.isArray(decoded)) {
    if (decoded.length === 0) return "[]";
    if (decoded.length > 5) {
      return `[${decoded.slice(0, 5).map((v) => formatGenericValue(v, indent)).join(", ")}, …]`;
    }
    return `[${decoded.map((v) => formatGenericValue(v, indent)).join(", ")}]`;
  }

  if (typeof decoded === "object") {
    const keys = Object.keys(decoded);
    if (keys.length === 0) return "{}";
    if (keys.length > 5) {
      const shown = keys
        .slice(0, 5)
        .map((k) => `${k}: ${formatGenericValue((decoded as Record<string, unknown>)[k], indent)}`)
        .join(", ");
      return `{${shown}, …}`;
    }
    const pairs = keys.map(
      (k) => `${k}: ${formatGenericValue((decoded as Record<string, unknown>)[k], indent)}`
    );
    return `{${pairs.join(", ")}}`;
  }

  return String(decoded);
}
