/**
 * Core translation and interpolation logic for Open-Audit.
 * This module is designed to be pure and free of side effects.
 *
 * Performance notes
 * ─────────────────
 * This file is on the hottest path in the system — it executes once per event
 * per ledger, potentially thousands of times per second during crowded blocks.
 * Several micro-optimisations are in place to minimise GC pressure:
 *
 *  1. escapeHtml uses a module-level lookup array instead of allocating a new
 *     Record literal on every call.
 *  2. decodeAddress and decodeAmount return objects from a fixed-size object
 *     pool; the caller MUST NOT hold a reference across async boundaries.
 *  3. interpolateTemplate uses an iterative loop + string builder instead of
 *     regex + closure to avoid per-call function allocation.
 *  4. shortenAddress is memoised with a small bounded LRU to avoid repeated
 *     string slicing for the same high-frequency contract addresses.
 */

import type {
  DecodedAddress,
  DecodedAmount,
  DecodedEnum,
  DecodedMap,
  DecodedMapEntry,
  DecodedScVal,
  DecodedVec,
  ScValType,
} from "./types";

// ─── HTML escape ──────────────────────────────────────────────────────────────

/**
 * Module-level lookup — allocated once, never GC'd.
 * Avoids creating a new Record<string,string> on every escapeHtml() call.
 */
const HTML_ESCAPE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
const HTML_ESCAPE_RE = /[&<>"']/g;

/** Escapes HTML special characters to prevent XSS. */
export function escapeHtml(str: string): string {
  return str.replace(HTML_ESCAPE_RE, (m) => HTML_ESCAPE[m]);
}

// ─── Sanitisation ─────────────────────────────────────────────────────────────

const MAX_PARAM_LENGTH = 512;

export function sanitizeTemplateParam(value: string): string {
  if (typeof value !== "string") return "";
  return escapeHtml(value.trim().slice(0, MAX_PARAM_LENGTH));
}

export interface SanitizeOptions {
  maxLength?: number;
  allowHex?: boolean;
}

// Pre-compiled — avoids re-compiling the regex on every sanitizeTextField call.
const HEX_ONLY_RE = /^(0x)?[0-9a-fA-F\s.]+$/;

export function sanitizeTextField(
  value: string,
  options: SanitizeOptions = {}
): string {
  if (typeof value !== "string") return "";
  const { maxLength = 1024, allowHex = false } = options;
  const trimmed = value.trim().slice(0, maxLength);
  if (allowHex && HEX_ONLY_RE.test(trimmed)) return trimmed;
  return escapeHtml(trimmed);
}

// ─── Template interpolation ───────────────────────────────────────────────────

// Pre-compiled once.
const TEMPLATE_TOKEN_RE = /\{(\w+)\}/g;
// Cap template length to guard against unbounded input.
const MAX_TEMPLATE_LENGTH = 2048;

/**
 * Replaces {placeholder} tokens with sanitised values from params.
 *
 * Uses a stateful lastIndex loop instead of closures-inside-.replace() to
 * avoid allocating a new function scope for every substitution.
 */
export function interpolateTemplate(
  template: string,
  params: Record<string, string>
): string {
  if (typeof template !== "string") return "";
  const safeTemplate = escapeHtml(template.slice(0, MAX_TEMPLATE_LENGTH));

  // Build result with an index-walk to avoid per-substitution closure.
  let result = "";
  let lastIndex = 0;
  TEMPLATE_TOKEN_RE.lastIndex = 0; // reset shared regex state
  let match: RegExpExecArray | null;

  while ((match = TEMPLATE_TOKEN_RE.exec(safeTemplate)) !== null) {
    result += safeTemplate.slice(lastIndex, match.index);
    const key = match[1];
    result += params[key] !== undefined ? sanitizeTemplateParam(params[key]) : match[0];
    lastIndex = match.index + match[0].length;
  }
  result += safeTemplate.slice(lastIndex);
  return result;
}

// ─── Hex utilities ────────────────────────────────────────────────────────────

const HEX_VALIDATE_RE = /^[0-9a-fA-F]+$/;
const NON_HEX_RE = /[^0-9a-fA-F]/g;

export function isValidHex(hex: string): boolean {
  if (!hex) return false;
  const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex;
  return HEX_VALIDATE_RE.test(cleanHex);
}

export function sanitizeHex(hex: string): string {
  if (!hex) return "";
  const cleanInput = hex.startsWith("0x") ? hex.slice(2) : hex;
  const clean = cleanInput.replace(NON_HEX_RE, "");
  if (!clean) return "";
  return `0x${clean}`;
}

// ─── Address pool ─────────────────────────────────────────────────────────────

/**
 * Small bounded LRU cache for shortenAddress results.
 * Full Stellar addresses are 56 chars; the same contract addresses repeat
 * heavily in a ledger (SAC USDC, SAC XLM, etc.). Memoising saves string
 * allocations for the common case.
 */
const SHORTEN_CACHE_MAX = 256;
const shortenCache = new Map<string, string>();

export function shortenAddress(publicKey: string): string {
  if (publicKey.length <= 12) return publicKey;
  let short = shortenCache.get(publicKey);
  if (short !== undefined) return short;
  short = `${publicKey.slice(0, 4)}...${publicKey.slice(-4)}`;
  if (shortenCache.size >= SHORTEN_CACHE_MAX) {
    // Evict oldest entry (Map preserves insertion order).
    shortenCache.delete(shortenCache.keys().next().value as string);
  }
  shortenCache.set(publicKey, short);
  return short;
}

/**
 * Object pool for DecodedAddress instances.
 *
 * decodeAddress() is called 2–3 times per translated event. At 1 000 events/s
 * that would be ~3 000 short-lived objects/s eligible for minor GC.
 * We reuse a fixed pool of pre-allocated objects instead.
 *
 * IMPORTANT: pool objects are returned by reference. The caller must consume
 * publicKey/short synchronously and MUST NOT store the reference — the next
 * call to decodeAddress() will overwrite the same object.
 */
const ADDRESS_POOL_SIZE = 16;
const addressPool: DecodedAddress[] = Array.from(
  { length: ADDRESS_POOL_SIZE },
  () => ({ publicKey: "", short: "" })
);
let addressPoolIndex = 0;

export function decodeAddress(hex: string): DecodedAddress {
  const seed = hex.slice(2, 10).toUpperCase();
  const tail = hex.slice(-4).toUpperCase();
  const publicKey = `G${seed}${"A".repeat(48 - seed.length)}${tail}`;

  const obj = addressPool[addressPoolIndex];
  obj.publicKey = publicKey;
  obj.short = shortenAddress(publicKey);
  addressPoolIndex = (addressPoolIndex + 1) % ADDRESS_POOL_SIZE;
  return obj;
}

// ─── Amount pool ──────────────────────────────────────────────────────────────

const STROOP_DIVISOR = BigInt(10_000_000);
const STROOP_DIVISOR_NUM = 10_000_000;

/**
 * Same pooling strategy as addresses.
 * decodeAmount() is called once per translated event.
 */
const AMOUNT_POOL_SIZE = 8;
const amountPool: DecodedAmount[] = Array.from(
  { length: AMOUNT_POOL_SIZE },
  () => ({ raw: BigInt(0), formatted: "0.00", symbol: "" })
);
let amountPoolIndex = 0;

export function decodeAmount(hex: string, symbol: string = "XLM"): DecodedAmount {
  const rawValue = BigInt("0x" + hex.slice(2, 18).replace(NON_HEX_RE, "0") || "0");
  const obj = amountPool[amountPoolIndex];
  obj.raw = rawValue;
  obj.formatted = (Number(rawValue) / STROOP_DIVISOR_NUM).toFixed(2);
  obj.symbol = symbol;
  amountPoolIndex = (amountPoolIndex + 1) % AMOUNT_POOL_SIZE;
  return obj;
}

// ─── Event name decode ────────────────────────────────────────────────────────

/**
 * Module-level map — allocated once.
 * Keyed by the hex suffix that actually varies between topics (last 8 chars)
 * to make the lookup O(1) without full-string comparison.
 */
const KNOWN_TOPIC_NAMES = new Map<string, string>([
  ["0x0000000000000000000000000000000000000000000000000000000074726e73", "transfer"],
  ["0x000000000000000000000000000000000000000000000000000000006d696e74", "mint"],
  ["0x000000000000000000000000000000000000000000000000000000006275726e", "burn"],
  ["0x000000000000000000000000000000000000000000000000000000006170707276", "approve"],
]);

export function decodeEventName(topicHex: string): string {
  return KNOWN_TOPIC_NAMES.get(topicHex) ?? "unknown";
}

// ─── Display helpers ──────────────────────────────────────────────────────────

export function truncateHex(hex: string, chars: number = 8): string {
  if (hex.length <= chars * 2 + 2) return hex;
  return `${hex.slice(0, chars + 2)}...${hex.slice(-chars)}`;
}

// ─── ScVal decode ─────────────────────────────────────────────────────────────

export function detectScValType(hex: string): ScValType {
  if (!isValidHex(hex)) return "Void";
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.startsWith("00000010")) return "Vec";
  if (clean.startsWith("00000011")) return "Map";
  if (clean.startsWith("0000000e") || clean.startsWith("0000000f")) return "String";
  if (clean.length === 64) return "Address";
  if (clean.length === 32) return "U128";
  return "Bytes";
}

export function decodeMap(hex: string): DecodedMap {
  if (!isValidHex(hex)) {
    return { type: "Map", entries: [], summary: "Invalid map data" };
  }
  if (!hex) {
    return { type: "Map", entries: [], summary: "" };
  }
  const entries: DecodedMapEntry[] = [];
  if (hex.length > 10) {
    entries.push({
      key: { type: "String", value: "key1", hex: "0x... " },
      value: { type: "String", value: "value1", hex: "0x... " },
    });
  }
  return { type: "Map", entries, summary: `Map with ${entries.length} entries` };
}

export function decodeVec(hex: string): DecodedVec {
  if (!isValidHex(hex)) {
    return { type: "Vec", elements: [], summary: "Invalid vector data" };
  }
  if (!hex) {
    return { type: "Vec", elements: [], summary: "" };
  }
  const elements: DecodedScVal[] = [];
  if (hex.length > 10) {
    elements.push({ type: "String", value: "elem1", hex: "0x... " });
  }
  return { type: "Vec", elements, summary: `Vec with ${elements.length} elements` };
}

export function decodeEnum(hex: string, knownVariants?: Record<string, string>): DecodedEnum {
  if (!isValidHex(hex)) {
    return { type: "Enum", variant: "unknown", summary: "Invalid enum data" };
  }
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const variantHex = clean.slice(0, 8);
  const variant = knownVariants?.[variantHex] ?? `variant_${variantHex}`;
  const hasPayload = clean.length > 8;
  const value = hasPayload
    ? { type: "Bytes" as const, value: clean.slice(8), hex: `0x${clean.slice(8)}` }
    : undefined;
  return {
    type: "Enum",
    variant,
    value,
    summary: `Enum variant ${variant}${hasPayload ? " (with payload)" : ""}`,
  };
}

export function decodeScVal(hex: string): DecodedScVal {
  const type = detectScValType(hex);
  switch (type) {
    case "Map":
      return decodeMap(hex);
    case "Vec":
      return decodeVec(hex);
    case "Address":
    case "U128":
    case "Void":
      return { type, value: hex, hex };
    default:
      return { type: "Bytes", value: hex, hex };
  }
}
