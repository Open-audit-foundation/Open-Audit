/**
 * Type declarations for the soroban-xdr-decode native N-API addon.
 *
 * These types mirror the Rust `#[napi]` exports in src/lib.rs.
 * All functions are synchronous (no Promise overhead) and run on the V8
 * main thread — latency is kept low by the native decode speed.
 */

// ── Discriminated union of all Soroban ScVal variants ────────────────────────

/** Primitive ScVal variants */
export interface ScValBool             { type: "Bool";                    value: boolean }
export interface ScValVoid             { type: "Void";                    value: null }
export interface ScValError            { type: "Error";                   value: string }
export interface ScValU32              { type: "U32";                     value: number }
export interface ScValI32              { type: "I32";                     value: number }
/** U64 / I64 serialised as strings to avoid JS precision loss */
export interface ScValU64              { type: "U64";                     value: string }
export interface ScValI64              { type: "I64";                     value: string }
export interface ScValTimepoint        { type: "Timepoint";               value: string }
export interface ScValDuration         { type: "Duration";                value: string }
/** 128-bit integers serialised as decimal strings */
export interface ScValU128             { type: "U128";                    value: string }
export interface ScValI128             { type: "I128";                    value: string }
/** 256-bit integers: four u64 limbs as strings */
export interface ScValU256             { type: "U256"; hi_hi: string; hi_lo: string; lo_hi: string; lo_lo: string }
export interface ScValI256             { type: "I256"; hi_hi: string; hi_lo: string; lo_hi: string; lo_lo: string }
/** Raw bytes hex-encoded */
export interface ScValBytes            { type: "Bytes";  value: string; len: number }
export interface ScValString           { type: "String"; value: string }
export interface ScValSymbol           { type: "Symbol"; value: string }
/** Stellar StrKey — G… (account) or C… (contract) */
export interface ScValAddress          { type: "Address"; value: string }
export interface ScValLedgerKeyContractInstance { type: "LedgerKeyContractInstance" }
export interface ScValLedgerKeyNonce   { type: "LedgerKeyNonce"; nonce: string }
export interface ScValVec              { type: "Vec";  value: DecodedScVal[] }
export interface ScValMapEntry         { key: DecodedScVal; value: DecodedScVal }
export interface ScValMap              { type: "Map";  value: ScValMapEntry[] }
export interface ScValContractInstance {
  type:       "ContractInstance";
  executable: string;
  storage?:   ScValMapEntry[];
}

export type DecodedScVal =
  | ScValBool | ScValVoid | ScValError
  | ScValU32  | ScValI32
  | ScValU64  | ScValI64  | ScValTimepoint | ScValDuration
  | ScValU128 | ScValI128
  | ScValU256 | ScValI256
  | ScValBytes | ScValString | ScValSymbol
  | ScValAddress
  | ScValLedgerKeyContractInstance | ScValLedgerKeyNonce
  | ScValVec | ScValMap | ScValContractInstance;

// ── Exported functions ────────────────────────────────────────────────────────

/**
 * Decode a single Soroban `ScVal` from a hex or base64-encoded XDR string.
 *
 * @param input - Bare hex, `0x`-prefixed hex, or standard base64 string.
 * @returns     A structured object describing the decoded ScVal variant.
 * @throws      `Error` if `input` cannot be decoded (malformed XDR / encoding).
 *
 * @example
 * ```ts
 * import { decodeScVal } from './index.node';
 * const result = decodeScVal('AAAAAA=='); // → { type: 'Void', value: null }
 * ```
 */
export declare function decodeScVal(input: string): DecodedScVal;

/**
 * Decode an ordered vector of Soroban topic `ScVal` strings.
 *
 * Fails fast: if any entry is malformed the call throws a JavaScript `Error`
 * identifying the offending index (`"topic[N]: …"`).
 *
 * @param inputs - Array of hex or base64 XDR strings.
 * @returns       Array of decoded ScVal objects in the same order.
 * @throws        `Error` on the first malformed entry.
 */
export declare function decodeTopics(inputs: string[]): DecodedScVal[];

/**
 * Decode a batch of `ScVal` strings, tolerating per-entry failures.
 *
 * Malformed entries produce `{ type: "Error", value: "<message>" }` at their
 * index rather than throwing — useful for bulk ingestion pipelines where a
 * single bad payload must not abort the whole batch.
 *
 * @param inputs - Array of hex or base64 XDR strings.
 * @returns       Array of decoded ScVal objects (or error objects).
 */
export declare function batchDecode(inputs: string[]): DecodedScVal[];

/**
 * Return the XDR schema generation this addon was compiled against.
 * Currently always `"curr"` (Soroban / Protocol 20+).
 */
export declare function xdrSchemaVersion(): string;
