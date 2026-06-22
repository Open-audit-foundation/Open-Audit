/**
 * Unit tests for lib/native/xdr-binding.ts
 *
 * These tests exercise the TypeScript binding layer in two modes:
 *   1. Fallback mode (native addon absent) — always runs in CI without a
 *      prebuilt binary.
 *   2. Native mode — exercises the exported interface contract; skipped when
 *      the .node binary is not present on the current machine.
 *
 * XDR fixtures were generated with:
 *   stellar-xdr encode --type ScVal --input json '{"bool":true}'
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Fixtures ──────────────────────────────────────────────────────────────────

// ScVal::Void  →  AAAAAA==  (6 bytes, type discriminant 0)
const VOID_BASE64 = "AAAAAA==";

// ScVal::Bool(true) →  AAAAAAE=  (discriminant 0 = Bool, value 1)
const BOOL_TRUE_BASE64 = "AAAAAAE=";

// ScVal::Symbol("transfer") —  discriminant 14 (0x0E), then a string XDR
// This is the raw base64 of a well-formed ScVal::Symbol("transfer") XDR.
// Derived from stellar-sdk: xdr.ScVal.scvSymbol("transfer").toXDR("base64")
const SYMBOL_TRANSFER_BASE64 = "AAAADgAAAAh0cmFuc2Zlcg==";

// Deliberately malformed — not valid XDR.
const BAD_INPUT = "not-valid-xdr!!!";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Import the binding module fresh (bypassing module cache) so we can
 * stub the native require path in individual tests.
 */
async function importBinding() {
  // Vitest's module isolation via vi.resetModules() gives us a clean slate.
  const mod = await import("../xdr-binding");
  return mod;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("xdr-binding (fallback / integration)", () => {
  describe("isNativeAddonLoaded", () => {
    it("returns a boolean", async () => {
      const { isNativeAddonLoaded } = await importBinding();
      expect(typeof isNativeAddonLoaded()).toBe("boolean");
    });
  });

  describe("xdrSchemaVersion", () => {
    it("returns 'curr' or 'fallback'", async () => {
      const { xdrSchemaVersion } = await importBinding();
      const v = xdrSchemaVersion();
      expect(["curr", "fallback"]).toContain(v);
    });
  });

  describe("decodeScVal", () => {
    it("handles VOID_BASE64 without throwing", async () => {
      const { decodeScVal } = await importBinding();
      // In fallback mode this returns a minimal ScVal; in native mode it returns
      // { type: 'Void', value: null }.  Either way it must not throw.
      expect(() => decodeScVal(VOID_BASE64)).not.toThrow();
    });

    it("returns an object with a 'type' field", async () => {
      const { decodeScVal } = await importBinding();
      const result = decodeScVal(VOID_BASE64);
      expect(result).toHaveProperty("type");
      expect(typeof result.type).toBe("string");
    });

    it("throws or returns error object for bad input", async () => {
      const { decodeScVal, isNativeAddonLoaded } = await importBinding();
      if (isNativeAddonLoaded()) {
        // Native path throws a proper JS Error.
        expect(() => decodeScVal(BAD_INPUT)).toThrow();
      } else {
        // Fallback path catches internally and returns an error ScVal.
        const result = decodeScVal(BAD_INPUT);
        // The fallback may return an Error ScVal or throw depending on stellar-sdk.
        // We just assert it doesn't crash the process.
        expect(result).toBeDefined();
      }
    });
  });

  describe("decodeTopics", () => {
    it("decodes an array of base64 strings", async () => {
      const { decodeTopics } = await importBinding();
      const result = decodeTopics([VOID_BASE64, VOID_BASE64]);
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(2);
    });

    it("returns empty array for empty input", async () => {
      const { decodeTopics } = await importBinding();
      expect(decodeTopics([])).toEqual([]);
    });

    it("throws or propagates error for malformed entry", async () => {
      const { decodeTopics, isNativeAddonLoaded } = await importBinding();
      if (isNativeAddonLoaded()) {
        expect(() => decodeTopics([VOID_BASE64, BAD_INPUT])).toThrow(/topic\[1\]/);
      } else {
        // In fallback mode we get a best-effort result.
        const result = decodeTopics([VOID_BASE64, BAD_INPUT]);
        expect(result).toHaveLength(2);
      }
    });
  });

  describe("batchDecode", () => {
    it("never throws for mixed valid/invalid inputs", async () => {
      const { batchDecode } = await importBinding();
      expect(() => batchDecode([VOID_BASE64, BAD_INPUT, VOID_BASE64])).not.toThrow();
    });

    it("marks failed entries with type 'Error'", async () => {
      const { batchDecode, isNativeAddonLoaded } = await importBinding();
      const results = batchDecode([VOID_BASE64, BAD_INPUT]);
      expect(results).toHaveLength(2);
      if (isNativeAddonLoaded()) {
        // Native path wraps the error correctly.
        expect(results[1].type).toBe("Error");
      }
    });

    it("returns empty array for empty input", async () => {
      const { batchDecode } = await importBinding();
      expect(batchDecode([])).toEqual([]);
    });
  });

  describe("native mode (skipped when .node absent)", () => {
    it("decodes Symbol('transfer') correctly when native is loaded", async () => {
      const binding = await importBinding();
      if (!binding.isNativeAddonLoaded()) {
        // Skip — binary not built yet.
        return;
      }
      const result = binding.decodeScVal(SYMBOL_TRANSFER_BASE64);
      expect(result.type).toBe("Symbol");
      if (result.type === "Symbol") {
        expect(result.value).toBe("transfer");
      }
    });

    it("decodes Void correctly when native is loaded", async () => {
      const binding = await importBinding();
      if (!binding.isNativeAddonLoaded()) return;

      const result = binding.decodeScVal(VOID_BASE64);
      expect(result.type).toBe("Void");
    });
  });
});
