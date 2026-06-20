/**
 * Dynamic UDT (User-Defined Type) Decoder for Soroban contract events.
 *
 * Soroban smart contracts embed an environment specification inside their
 * on-chain WASM binary. This module:
 *
 *   1. Fetches the contract's WASM bytecode via the Soroban RPC `getLedgerEntries`
 *      method and extracts the embedded `contractSpecV0` XDR section.
 *   2. Parses `ScSpecEntry` records to build a type map of all UDTs defined by
 *      the contract (structs and enums).
 *   3. Decodes raw `ScVal` hex strings — including deeply nested map/vec/struct
 *      shapes — into plain JavaScript objects with human-readable field names.
 *   4. Caches resolved type maps in memory so repeated events from the same
 *      contract skip the RPC round-trip.
 *   5. Falls back to safe truncated hex on any decoding or fetch error, so the
 *      parsing pipeline never crashes.
 */

import { xdr as StellarXdr, StrKey } from "stellar-sdk";
import { getNetworkConfig } from "../stellar/client";
import { truncateHex } from "./decode";

// ── Types ────────────────────────────────────────────────────────────────────

/** A single field in a UDT struct. */
interface UdtStructField {
  name: string;
  /** The XDR type name, e.g. "Address", "I128", "Symbol", or another UDT name. */
  typeName: string;
}

/** A single variant in a UDT enum. */
interface UdtEnumVariant {
  name: string;
  value: number;
}

/** Discriminated union representing a resolved UDT definition. */
type UdtDefinition =
  | { kind: "struct"; fields: UdtStructField[] }
  | { kind: "enum"; variants: UdtEnumVariant[] };

/** Maps UDT name → its parsed definition. */
interface ContractTypeMap {
  udts: Map<string, UdtDefinition>;
}

/** A decoded UDT value ready for display. */
export interface DecodedUdt {
  /** The UDT name, e.g. "SwapParams". */
  typeName: string;
  /** Human-readable key→value pairs. */
  fields: Record<string, string>;
}

// ── Cache ────────────────────────────────────────────────────────────────────

/** In-memory cache: contractId → resolved type map. */
const SPEC_CACHE = new Map<string, ContractTypeMap>();

/** Cache metrics accessible for monitoring. */
export interface CacheMetrics {
  hits: number;
  misses: number;
}

const metrics: CacheMetrics = { hits: 0, misses: 0 };

/** Returns a snapshot of cache hit/miss counters. */
export function getCacheMetrics(): CacheMetrics {
  return { ...metrics };
}

/** Clears the in-memory spec cache (useful in tests). */
export function clearSpecCache(): void {
  SPEC_CACHE.clear();
  metrics.hits = 0;
  metrics.misses = 0;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Decodes a raw hex-encoded `ScVal` against the named UDT from the contract's
 * on-chain spec.
 *
 * Returns a {@link DecodedUdt} on success, or `null` with a hex fallback
 * logged when the spec cannot be fetched or the value cannot be decoded.
 *
 * @param contractId  The Soroban contract that emitted the value.
 * @param udtName     The Rust type name to resolve, e.g. "SwapParams".
 * @param scValHex    Hex-encoded `ScVal` bytes (with or without "0x" prefix).
 */
export async function decodeUdt(
  contractId: string,
  udtName: string,
  scValHex: string
): Promise<DecodedUdt | null> {
  try {
    const typeMap = await resolveTypeMap(contractId);
    const scVal = parseScVal(scValHex);
    const decoded = decodeScValWithType(scVal, udtName, typeMap);
    return decoded ?? { typeName: udtName, fields: { raw: truncateHex(scValHex) } };
  } catch (err) {
    console.warn(
      `[open-audit:udt-decoder] Graceful degradation for ${contractId}/${udtName}:`,
      (err as Error).message
    );
    return { typeName: udtName, fields: { raw: truncateHex(scValHex) } };
  }
}

/**
 * Decodes an array of raw ScVal hex strings (event topics + data) using the
 * contract's full UDT spec.  Fields that cannot be resolved are returned as
 * truncated hex strings — the pipeline never throws.
 *
 * @param contractId  The emitting contract.
 * @param scValHexes  All ScVal hex strings from the event (topics + data).
 * @returns           Flat array of human-readable strings, one per ScVal.
 */
export async function decodeEventPayload(
  contractId: string,
  scValHexes: string[]
): Promise<string[]> {
  let typeMap: ContractTypeMap | null = null;
  try {
    typeMap = await resolveTypeMap(contractId);
  } catch {
    // Spec unavailable — fall through to hex fallback for all values.
  }

  return scValHexes.map(function (hex: string): string {
    try {
      const scVal = parseScVal(hex);
      return scValToString(scVal, typeMap);
    } catch {
      return truncateHex(hex);
    }
  });
}

// ── Spec Fetching ─────────────────────────────────────────────────────────────

/**
 * Returns the type map for a contract, using the in-memory cache when
 * available and fetching + parsing the on-chain spec otherwise.
 */
async function resolveTypeMap(contractId: string): Promise<ContractTypeMap> {
  const cached = SPEC_CACHE.get(contractId);
  if (cached) {
    metrics.hits++;
    console.log(`[open-audit:udt-decoder] cache HIT  for ${contractId} (hits=${metrics.hits})`);
    return cached;
  }

  metrics.misses++;
  console.log(`[open-audit:udt-decoder] cache MISS for ${contractId} (misses=${metrics.misses})`);

  const specEntries = await fetchContractSpec(contractId);
  const typeMap = buildTypeMap(specEntries);
  SPEC_CACHE.set(contractId, typeMap);
  return typeMap;
}

/**
 * Fetches the contract's `ScSpecEntry` list from the Soroban RPC by:
 *   1. Looking up the `ContractData` ledger entry for the WASM hash.
 *   2. Looking up the `ContractCode` ledger entry for the WASM bytes.
 *   3. Extracting and parsing the `contractSpecV0` custom section from the WASM.
 *
 * Uses `stellar-sdk`'s XDR helpers so this works without a Wasm runtime.
 */
async function fetchContractSpec(contractId: string): Promise<StellarXdr.ScSpecEntry[]> {
  const { SorobanRpc, xdr } = await import("stellar-sdk");
  const config = getNetworkConfig();
  const server = new SorobanRpc.Server(config.sorobanRpcUrl);

  // Build the ledger key for the contract's executable (WASM hash pointer).
  const contractDataKey = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new xdr.ScAddress.scAddressTypeContract({ contractId: StrKey.decodeContract(contractId) }),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    })
  );

  const dataResult = await server.getLedgerEntries(contractDataKey);
  if (!dataResult.entries.length) {
    throw new Error(`No ledger entry found for contract ${contractId}`);
  }

  const contractData = dataResult.entries[0].val.contractData();
  const executable = contractData.val().instance().executable();

  if (executable.switch() !== xdr.ContractExecutableType.contractExecutableWasm()) {
    throw new Error(`Contract ${contractId} is not a WASM contract`);
  }

  const wasmHash = executable.wasmHash();
  const codeKey = xdr.LedgerKey.contractCode(
    new xdr.LedgerKeyContractCode({ hash: wasmHash })
  );

  const codeResult = await server.getLedgerEntries(codeKey);
  if (!codeResult.entries.length) {
    throw new Error(`No WASM code entry found for contract ${contractId}`);
  }

  const wasmBytes = codeResult.entries[0].val.contractCode().code();
  return extractSpecFromWasm(wasmBytes);
}

/**
 * Walks the WASM binary looking for the `contractSpecV0` custom section.
 * Custom sections start with a 0x00 id byte, followed by a LEB128 size, then
 * a length-prefixed name, then the payload XDR bytes.
 */
function extractSpecFromWasm(wasm: Buffer): StellarXdr.ScSpecEntry[] {
  const { xdr } = require("stellar-sdk");
  const TARGET_SECTION = "contractSpecV0";
  let offset = 8; // skip 4-byte magic + 4-byte version

  while (offset < wasm.length) {
    const sectionId = wasm[offset];
    offset += 1;
    const [sectionSize, sizeLen] = readLeb128(wasm, offset);
    offset += sizeLen;
    const sectionEnd = offset + sectionSize;

    if (sectionId === 0x00) {
      const [nameLen, nameLenBytes] = readLeb128(wasm, offset);
      const nameStart = offset + nameLenBytes;
      const name = wasm.subarray(nameStart, nameStart + nameLen).toString("utf8");

      if (name === TARGET_SECTION) {
        const payloadStart = nameStart + nameLen;
        const payloadBytes = wasm.subarray(payloadStart, sectionEnd);
        return parseSpecEntries(payloadBytes, xdr);
      }
    }

    offset = sectionEnd;
  }

  throw new Error("contractSpecV0 custom section not found in WASM binary");
}

/** Parses a raw payload buffer into an array of `ScSpecEntry`. */
function parseSpecEntries(
  payload: Uint8Array,
  xdr: typeof StellarXdr
): StellarXdr.ScSpecEntry[] {
  const entries: StellarXdr.ScSpecEntry[] = [];
  let offset = 0;

  while (offset < payload.length) {
    // Each entry is length-prefixed (4-byte big-endian).
    const len = new DataView(payload.buffer, payload.byteOffset + offset, 4).getUint32(0, false);
    offset += 4;
    const entryBytes = payload.subarray(offset, offset + len);
    offset += len;

    try {
      entries.push(xdr.ScSpecEntry.fromXDR(Buffer.from(entryBytes)));
    } catch {
      // Skip malformed entries — parse as many as we can.
    }
  }

  return entries;
}

// ── Type Map Builder ──────────────────────────────────────────────────────────

/**
 * Converts an array of `ScSpecEntry` records into a fast-lookup type map.
 * Only struct and union-enum entries are relevant for UDT decoding.
 */
function buildTypeMap(entries: StellarXdr.ScSpecEntry[]): ContractTypeMap {
  const udts = new Map<string, UdtDefinition>();

  for (const entry of entries) {
    const kind = entry.switch();

    if (kind === StellarXdr.ScSpecEntryKind.scSpecEntryUdtStructV0()) {
      const def = entry.udtStructV0();
      const fields: UdtStructField[] = def.fields().map(function (
        f: StellarXdr.ScSpecUdtStructFieldV0
      ): UdtStructField {
        return {
          name: f.name().toString(),
          typeName: scSpecTypeToName(f.type()),
        };
      });
      udts.set(def.name().toString(), { kind: "struct", fields });
    } else if (kind === StellarXdr.ScSpecEntryKind.scSpecEntryUdtUnionV0()) {
      const def = entry.udtUnionV0();
      const variants: UdtEnumVariant[] = def.cases().map(function (
        c: StellarXdr.ScSpecUdtUnionCaseV0,
        i: number
      ): UdtEnumVariant {
        return { name: c.voidCase?.().name?.().toString() ?? `Variant${i}`, value: i };
      });
      udts.set(def.name().toString(), { kind: "enum", variants });
    }
  }

  return { udts };
}

/** Returns a human-readable name for an `ScSpecTypeDef`. */
function scSpecTypeToName(typeDef: StellarXdr.ScSpecTypeDef): string {
  const kind = typeDef.switch();
  const map: Partial<Record<string, string>> = {
    scSpecTypeVal: "Val",
    scSpecTypeBool: "Bool",
    scSpecTypeVoid: "Void",
    scSpecTypeError: "Error",
    scSpecTypeU32: "U32",
    scSpecTypeI32: "I32",
    scSpecTypeU64: "U64",
    scSpecTypeI64: "I64",
    scSpecTypeU128: "U128",
    scSpecTypeI128: "I128",
    scSpecTypeU256: "U256",
    scSpecTypeI256: "I256",
    scSpecTypeBytes: "Bytes",
    scSpecTypeString: "String",
    scSpecTypeSymbol: "Symbol",
    scSpecTypeAddress: "Address",
  };
  return map[kind.name] ?? kind.name;
}

// ── ScVal Decoding ────────────────────────────────────────────────────────────

/** Parses a hex string (with or without 0x prefix) into an XDR `ScVal`. */
function parseScVal(hex: string): StellarXdr.ScVal {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  return StellarXdr.ScVal.fromXDR(clean, "hex");
}

/**
 * Recursively decodes an `ScVal` into a human-readable string.
 * Resolves named UDTs from the type map when available.
 */
function scValToString(scVal: StellarXdr.ScVal, typeMap: ContractTypeMap | null): string {
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
      return formatScAddress(scVal.address());
    case "scvMap": {
      const entries = scVal.map() ?? [];
      const parts = entries.map(function (entry: StellarXdr.ScMapEntry): string {
        const k = scValToString(entry.key(), typeMap);
        const v = scValToString(entry.val(), typeMap);
        return `${k}: ${v}`;
      });
      return `{${parts.join(", ")}}`;
    }
    case "scvVec": {
      const items = scVal.vec() ?? [];
      return `[${items.map(function (v: StellarXdr.ScVal): string { return scValToString(v, typeMap); }).join(", ")}]`;
    }
    default:
      return truncateHex(scVal.toXDR("hex"));
  }
}

/**
 * Decodes an `ScVal` against a named UDT from the type map.
 * Returns null when the type is not found or the value shape doesn't match.
 */
function decodeScValWithType(
  scVal: StellarXdr.ScVal,
  typeName: string,
  typeMap: ContractTypeMap
): DecodedUdt | null {
  const udt = typeMap.udts.get(typeName);
  if (!udt) return null;

  if (udt.kind === "struct" && scVal.switch().name === "scvMap") {
    const entries = scVal.map() ?? [];
    const fields: Record<string, string> = {};

    for (const entry of entries) {
      const fieldName = scValToString(entry.key(), typeMap);
      const fieldDef = udt.fields.find(function (f: UdtStructField): boolean {
        return f.name === fieldName;
      });
      const valueStr = fieldDef
        ? scValToString(entry.val(), typeMap)
        : scValToString(entry.val(), typeMap);
      fields[fieldName] = valueStr;
    }

    return { typeName, fields };
  }

  if (udt.kind === "enum" && scVal.switch().name === "scvVec") {
    const items = scVal.vec() ?? [];
    const discriminant = items[0] ? scValToString(items[0], typeMap) : "unknown";
    const variant = udt.variants.find(function (v: UdtEnumVariant): boolean {
      return v.name === discriminant;
    });
    const fields: Record<string, string> = { variant: variant?.name ?? discriminant };
    if (items.length > 1) {
      fields.value = scValToString(items[1], typeMap);
    }
    return { typeName, fields };
  }

  // Value shape doesn't match the UDT definition — return a generic decode.
  return { typeName, fields: { value: scValToString(scVal, typeMap) } };
}

/** Formats a Soroban `ScAddress` into a human-readable Stellar address. */
function formatScAddress(address: StellarXdr.ScAddress): string {
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
}

// ── WASM Binary Utilities ─────────────────────────────────────────────────────

/** Reads an unsigned LEB128 integer from `buf` at `offset`. Returns [value, byteLength]. */
function readLeb128(buf: Buffer, offset: number): [number, number] {
  let result = 0;
  let shift = 0;
  let bytesRead = 0;

  while (offset + bytesRead < buf.length) {
    const byte = buf[offset + bytesRead];
    bytesRead++;
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }

  return [result, bytesRead];
}
