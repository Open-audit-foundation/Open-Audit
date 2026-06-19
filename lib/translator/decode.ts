/**
 * Hex decoding utilities for Soroban event data.
 *
 * Soroban events encode their topics and data as XDR (External Data Representation).
 * These helpers provide simplified decoding for common patterns.
 */

import type { DecodedAddress, DecodedAmount, DecodedMap, DecodedVec, DecodedEnum, DecodedScVal, ScValType } from "./types";

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

/**
 * Interpolates a template string by replacing {key} placeholders with values.
 */
export function interpolateTemplate(template: string, params: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(params, key) ? params[key] : match
  );
}

/** Returns true if the string is a valid hex string (with or without 0x prefix). */
export function isValidHex(value: unknown): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  const hex = value.startsWith("0x") ? value.slice(2) : value;
  if (hex.length === 0) return false;
  return /^[0-9a-fA-F]+$/.test(hex);
}

/** Sanitizes a hex string by stripping non-hex characters and ensuring 0x prefix. */
export function sanitizeHex(value: string): string {
  if (value.length === 0) return "";
  const hasPrefix = value.startsWith("0x");
  const raw = hasPrefix ? value.slice(2) : value;
  const cleaned = raw.replace(/[^0-9a-fA-F]/g, "");
  if (cleaned.length === 0) return "";
  return "0x" + cleaned;
}

/** Escapes HTML special characters to prevent XSS. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Detects the ScVal type from the first 4 bytes of a hex string. */
export function detectScValType(hex: string): ScValType {
  if (!isValidHex(hex)) return "Void";
  const stripped = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (stripped.length === 0) return "Void";

  // 32-byte (64 hex chars) heuristic → Address
  if (stripped.length === 64) return "Address";
  // 16-byte (32 hex chars) heuristic → U128
  if (stripped.length === 32) return "U128";

  const tag = parseInt(stripped.slice(0, 8), 16);
  switch (tag) {
    case 0x10: return "Vec";
    case 0x11: return "Map";
    case 0x0e:
    case 0x0f: return "String";
    default: return "Bytes";
  }
}

/** Decodes a hex-encoded ScMap into a DecodedMap. */
export function decodeMap(hex: string): DecodedMap {
  if (!hex || !isValidHex(hex)) {
    return { type: "Map", entries: [], summary: hex ? "Invalid map data" : "" };
  }
  try {
    const stripped = hex.startsWith("0x") ? hex.slice(2) : hex;
    const count = stripped.length > 0 ? Math.floor(stripped.length / 32) : 0;
    return {
      type: "Map",
      entries: [],
      summary: `Map(${count} entries)`,
    };
  } catch {
    return { type: "Map", entries: [], summary: "Invalid map data" };
  }
}

/** Decodes a hex-encoded ScVec into a DecodedVec. */
export function decodeVec(hex: string): DecodedVec {
  if (!hex || !isValidHex(hex)) {
    return { type: "Vec", elements: [], summary: hex ? "Invalid vector data" : "" };
  }
  try {
    const stripped = hex.startsWith("0x") ? hex.slice(2) : hex;
    const count = stripped.length > 0 ? Math.floor(stripped.length / 16) : 0;
    return {
      type: "Vec",
      elements: [],
      summary: `Vec(${count} elements)`,
    };
  } catch {
    return { type: "Vec", elements: [], summary: "Invalid vector data" };
  }
}

/** Decodes a hex-encoded enum variant into a DecodedEnum. */
export function decodeEnum(hex: string, knownVariants?: Record<string, string>): DecodedEnum {
  if (!hex || !isValidHex(hex)) {
    return { type: "Enum", variant: "unknown", summary: "Invalid enum data" };
  }
  try {
    const stripped = hex.startsWith("0x") ? hex.slice(2) : hex;
    const discriminant = stripped.slice(0, 8).toLowerCase();
    const variant = knownVariants?.[discriminant] ?? `variant_0x${discriminant}`;
    const hasPayload = stripped.length > 8;
    const value: DecodedScVal | undefined = hasPayload
      ? { type: "Bytes", value: stripped.slice(8), hex: "0x" + stripped.slice(8) }
      : undefined;
    const summary = value ? `Enum::${variant}(${value.value.slice(0, 8)}...)` : `Enum::${variant}`;
    return { type: "Enum", variant, value, summary };
  } catch {
    return { type: "Enum", variant: "unknown", summary: "Invalid enum data" };
  }
}

/** Dispatches hex decoding to the appropriate typed decoder. */
export function decodeScVal(hex: string): DecodedScVal | DecodedMap | DecodedVec {
  if (!isValidHex(hex)) {
    return { type: "Void", value: hex, hex };
  }
  const type = detectScValType(hex);
  switch (type) {
    case "Map": return decodeMap(hex);
    case "Vec": return decodeVec(hex);
    case "Address": return { type: "Address", value: decodeAddress(hex).short, hex };
    case "U128": return { type: "U128", value: hex, hex };
    default: return { type: "Void", value: hex, hex };
  }
}
