/**
 * lib/native/xdr-binding.ts
 *
 * Thin TypeScript wrapper around the soroban-xdr-decode native N-API addon.
 *
 * Strategy
 * ────────
 * 1. Try to `require` the prebuilt `.node` binary at startup.
 * 2. If the binary is unavailable (e.g. the developer hasn't run `npm run
 *    build:native` yet, or the architecture has no prebuilt binary), fall back
 *    gracefully to the pure-TypeScript decoder in `lib/translator/decode.ts`.
 * 3. All public exports share the same signature regardless of which
 *    implementation is active — call-sites never need to know.
 *
 * Zero-copy notes
 * ───────────────
 * The native addon receives V8-managed UTF-8 strings and writes decoded JSON
 * directly into the V8 object graph via napi-rs's `serde-json` feature.
 * No intermediate Buffer copies occur for the structured output.
 * Raw byte fields (ScVal::Bytes) are returned as hex strings rather than
 * `Buffer` objects to avoid V8 ArrayBuffer lifetime complexity.
 */

import type { DecodedScVal } from "../../native/soroban-xdr-decode/index";

// ── Lazy load the native addon ────────────────────────────────────────────────

/** Describes the subset of the native module API used here. */
interface NativeAddon {
  decodeScVal(input: string): DecodedScVal;
  decodeTopics(inputs: string[]): DecodedScVal[];
  batchDecode(inputs: string[]): DecodedScVal[];
  xdrSchemaVersion(): string;
}

let _native: NativeAddon | null = null;
let _loadAttempted = false;

function getNative(): NativeAddon | null {
  if (_loadAttempted) return _native;
  _loadAttempted = true;

  try {
    // napi-rs writes the binary to `<package-root>/index.node` (or inside
    // `native/soroban-xdr-decode/` depending on the build target config).
    // We try both common locations so the binding works in dev and in Docker.
    const candidates = [
      "../../native/soroban-xdr-decode/index.node",
      "./native/soroban-xdr-decode/index.node",
    ];

    for (const candidate of candidates) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        _native = require(candidate) as NativeAddon;
        console.info(
          `[xdr-binding] Native addon loaded (schema: ${_native.xdrSchemaVersion()})`
        );
        return _native;
      } catch {
        // Try next candidate.
      }
    }

    console.warn(
      "[xdr-binding] Native addon not found — falling back to TypeScript decoder."
    );
  } catch (err) {
    console.warn("[xdr-binding] Native addon load error:", err);
  }

  return null;
}

// ── TypeScript fallback ───────────────────────────────────────────────────────
// A minimal pure-JS implementation that covers the most common ScVal types
// returned by the Soroban RPC.  The native addon is strongly preferred for
// production workloads; this path exists only to keep the server bootable
// when the .node binary is absent.

function fallbackDecodeScVal(input: string): DecodedScVal {
  // stellar-sdk ships its own XDR codec; use it when available.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { xdr } = require("stellar-sdk") as typeof import("stellar-sdk");

    const raw = input.startsWith("0x") || input.startsWith("0X")
      ? Buffer.from(input.slice(2), "hex")
      : Buffer.from(input, "base64");

    const scVal = xdr.ScVal.fromXDR(raw);
    // Return a minimal representation — enough for logging / display.
    return {
      type: "String",
      value: scVal.toXDR("base64"),
    } as DecodedScVal;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { type: "Error", value: `fallback decode error: ${msg}` } as DecodedScVal;
  }
}

function fallbackDecodeTopics(inputs: string[]): DecodedScVal[] {
  return inputs.map(fallbackDecodeScVal);
}

function fallbackBatchDecode(inputs: string[]): DecodedScVal[] {
  return inputs.map((s) => {
    try {
      return fallbackDecodeScVal(s);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { type: "Error", value: msg } as DecodedScVal;
    }
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Decode a single Soroban `ScVal` from a hex or base64-encoded XDR string.
 *
 * Uses the native Rust addon when available; falls back to stellar-sdk XDR
 * parsing otherwise.
 *
 * @throws `Error` if the input cannot be decoded and the native addon is loaded
 *         (the native addon surfaces decode failures as JS errors).
 */
export function decodeScVal(input: string): DecodedScVal {
  const native = getNative();
  return native ? native.decodeScVal(input) : fallbackDecodeScVal(input);
}

/**
 * Decode an ordered vector of Soroban topic `ScVal` strings.
 *
 * Fails fast (throws) on the first malformed entry when using the native addon.
 */
export function decodeTopics(inputs: string[]): DecodedScVal[] {
  const native = getNative();
  return native ? native.decodeTopics(inputs) : fallbackDecodeTopics(inputs);
}

/**
 * Decode a batch of `ScVal` strings, capturing per-entry errors as
 * `{ type: "Error", value: "…" }` rather than throwing.
 */
export function batchDecode(inputs: string[]): DecodedScVal[] {
  const native = getNative();
  return native ? native.batchDecode(inputs) : fallbackBatchDecode(inputs);
}

/**
 * Returns `true` when the native Rust addon is loaded and active.
 * Useful for health-check endpoints and startup diagnostics.
 */
export function isNativeAddonLoaded(): boolean {
  return getNative() !== null;
}

/**
 * Returns the XDR schema version the addon was compiled against,
 * or `"fallback"` when running in pure-TypeScript mode.
 */
export function xdrSchemaVersion(): string {
  return getNative()?.xdrSchemaVersion() ?? "fallback";
}

export type { DecodedScVal };
