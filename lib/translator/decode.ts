/**
 * Hex decoding utilities for Soroban event data.
 *
 * Soroban events encode their topics and data as XDR (External Data Representation).
 * These helpers provide simplified decoding for common patterns.
 */

import type { DecodedAddress, DecodedAmount } from "./types";

// ─── Template interpolation ──────────────────────────────────────────────────

/**
 * Replaces `{key}` placeholders in a template string with values from params.
 * Unknown placeholders are left intact.
 */
export function interpolateTemplate(
  template: string,
  params: Record<string, string>
): string {
  return template.replace(/\{(\w+)\}/g, function (match, key) {
    return Object.prototype.hasOwnProperty.call(params, key) ? params[key] : match;
  });
}

// ─── Hex validation & sanitization ───────────────────────────────────────────

/** Returns true if the string is a valid hex value (with or without 0x prefix). */
export function isValidHex(value: unknown): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  const stripped = value.startsWith("0x") || value.startsWith("0X") ? value.slice(2) : value;
  return stripped.length > 0 && /^[0-9a-fA-F]+$/.test(stripped);
}

/** Removes non-hex characters from a string, preserving an optional 0x prefix. */
export function sanitizeHex(value: string): string {
  if (value.length === 0) return "";
  const hasPrefix = value.startsWith("0x") || value.startsWith("0X");
  const stripped = hasPrefix ? value.slice(2) : value;
  const clean = stripped.replace(/[^0-9a-fA-F]/g, "");
  if (clean.length === 0) return "";
  return `0x${clean}`;
}

/** Escapes HTML special characters to prevent XSS when rendering hex in HTML. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ─── ScVal type detection ─────────────────────────────────────────────────────

type ScValTypeName = "Vec" | "Map" | "Address" | "String" | "Bytes" | "U128" | "Void";

/** Detects the ScVal type from a hex prefix or byte length heuristic. */
export function detectScValType(hex: string): ScValTypeName {
  if (!isValidHex(hex)) return "Void";
  const stripped = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (stripped.length === 0) return "Void";

  const prefix = stripped.slice(0, 8).toLowerCase();
  if (prefix === "00000010") return "Vec";
  if (prefix === "00000011") return "Map";
  if (prefix === "0000000e" || prefix === "0000000f") return "String";

  // 32-byte (64 hex chars) with no known XDR prefix → treat as Address
  if (stripped.length === 64) return "Address";
  // 16-byte (32 hex chars) → treat as U128
  if (stripped.length === 32) return "U128";

  return "Bytes";
}

// ─── Complex ScVal decoders ───────────────────────────────────────────────────

export interface MapDecodeResult {
  type: "Map";
  entries: Array<{ key: string; value: string }>;
  summary: string;
}

export interface VecDecodeResult {
  type: "Vec";
  elements: string[];
  summary: string;
}

export interface EnumDecodeResult {
  type: "Enum";
  variant: string;
  value?: string;
  summary: string;
}

export type ScValDecodeResult =
  | MapDecodeResult
  | VecDecodeResult
  | EnumDecodeResult
  | { type: "Address"; value: string }
  | { type: "U128"; value: string }
  | { type: "Void"; value: string };

/** Decodes a hex-encoded XDR map into key/value entries. */
export function decodeMap(hex: string): MapDecodeResult {
  if (!hex || !isValidHex(hex)) {
    return { type: "Map", entries: [], summary: "Invalid map data" };
  }
  const stripped = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (stripped.length === 0) {
    return { type: "Map", entries: [], summary: "" };
  }
  // Simplified heuristic: chunk payload into key/value pairs of 32 hex chars each
  const payload = stripped.slice(8); // skip 4-byte prefix
  const entries: Array<{ key: string; value: string }> = [];
  for (let i = 0; i + 64 <= payload.length; i += 64) {
    entries.push({
      key: `0x${payload.slice(i, i + 32)}`,
      value: `0x${payload.slice(i + 32, i + 64)}`,
    });
  }
  return {
    type: "Map",
    entries,
    summary: `Map(${entries.length} entries)`,
  };
}

/** Decodes a hex-encoded XDR vector into an array of elements. */
export function decodeVec(hex: string): VecDecodeResult {
  if (!hex || !isValidHex(hex)) {
    return { type: "Vec", elements: [], summary: "Invalid vector data" };
  }
  const stripped = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (stripped.length === 0) {
    return { type: "Vec", elements: [], summary: "" };
  }
  const payload = stripped.slice(8);
  const elements: string[] = [];
  for (let i = 0; i + 32 <= payload.length; i += 32) {
    elements.push(`0x${payload.slice(i, i + 32)}`);
  }
  return {
    type: "Vec",
    elements,
    summary: `Vec(${elements.length} elements)`,
  };
}

/**
 * Decodes a hex-encoded XDR enum variant.
 * @param knownVariants Optional map from 8-hex-char discriminant to variant name.
 */
export function decodeEnum(
  hex: string,
  knownVariants?: Record<string, string>
): EnumDecodeResult {
  if (!hex || !isValidHex(hex)) {
    return { type: "Enum", variant: "unknown", summary: "Invalid enum data" };
  }
  const stripped = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (stripped.length < 8) {
    return { type: "Enum", variant: "unknown", summary: "Invalid enum data" };
  }
  const discriminant = stripped.slice(0, 8).toLowerCase();
  const variantName = knownVariants?.[discriminant] ?? `variant_${discriminant}`;
  const payload = stripped.slice(8);
  if (payload.length === 0) {
    return { type: "Enum", variant: variantName, summary: `Enum::${variantName}` };
  }
  const value = `0x${payload}`;
  return {
    type: "Enum",
    variant: variantName,
    value,
    summary: `Enum::${variantName}(${value.slice(0, 10)}...)`,
  };
}

/**
 * Top-level dispatcher: detects the ScVal type and delegates to the
 * appropriate decoder.
 */
export function decodeScVal(hex: string): ScValDecodeResult {
  const type = detectScValType(hex);
  switch (type) {
    case "Map":
      return decodeMap(hex);
    case "Vec":
      return decodeVec(hex);
    case "Address":
      return { type: "Address", value: hex };
    case "U128":
      return { type: "U128", value: hex };
    case "Void":
      return { type: "Void", value: hex };
    default:
      return decodeEnum(hex);
  }
}

const STROOP_DIVISOR = BigInt(10_000_000);

/**
 * Shortens a Stellar public key for display.
 * e.g. "GABC...WXYZ1234" → "GABC...1234"
 */
export function shortenAddress(publicKey: string): string {
  if (publicKey.length <= 12) return publicKey;
  return `${publicKey.slice(0, 4)}...${publicKey.slice(-4)}`;
}

/**
 * Decodes a mock hex-encoded Stellar address.
 * In production this would use stellar-sdk XDR decoding.
 */
export function decodeAddress(hex: string): DecodedAddress {
  // Mock: derive a deterministic G-address from the hex for demo purposes.
  // Production: use StellarSdk.xdr.ScVal.fromXDR(hex, 'hex') and extract the address.
  const seed = hex.slice(2, 10).toUpperCase();
  const tail = hex.slice(-4).toUpperCase();
  const publicKey = `G${seed}${"A".repeat(48 - seed.length)}${tail}`;

  return {
    publicKey,
    short: shortenAddress(publicKey),
  };
}

/**
 * Decodes a mock hex-encoded i128 amount (in stroops) to a human-readable value.
 * In production this would use stellar-sdk XDR decoding.
 */
export function decodeAmount(hex: string, symbol: string = "XLM"): DecodedAmount {
  // Mock: derive a deterministic amount from the hex for demo purposes.
  // Production: use StellarSdk.xdr.ScVal.fromXDR(hex, 'hex') and extract the i128.
  const rawValue = BigInt("0x" + hex.slice(2, 18).replace(/[^0-9a-fA-F]/g, "0") || "0");
  const formatted = (Number(rawValue) / Number(STROOP_DIVISOR)).toFixed(2);

  return {
    raw: rawValue,
    formatted,
    symbol,
  };
}

/**
 * Extracts the event name from the first topic hex string.
 * Soroban encodes event names as Symbol XDR values.
 * In production this would decode the XDR Symbol type.
 */
export function decodeEventName(topicHex: string): string {
  // Mock: map known topic hashes to event names for demo purposes.
  const knownTopics: Record<string, string> = {
    "0x0000000000000000000000000000000000000000000000000000000074726e73":
      "transfer",
    "0x000000000000000000000000000000000000000000000000000000006d696e74":
      "mint",
    "0x000000000000000000000000000000000000000000000000000000006275726e":
      "burn",
    "0x000000000000000000000000000000000000000000000000000000006170707276":
      "approve",
  };

  return knownTopics[topicHex] ?? "unknown";
}

/**
 * Formats a Unix timestamp into a human-readable relative time string.
 */
export function formatRelativeTime(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;

  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

/**
 * Truncates a hex string for display, showing start and end.
 * e.g. "0x000000...FFFF"
 */
export function truncateHex(hex: string, chars: number = 8): string {
  if (hex.length <= chars * 2 + 2) return hex;
  return `${hex.slice(0, chars + 2)}...${hex.slice(-chars)}`;
}
