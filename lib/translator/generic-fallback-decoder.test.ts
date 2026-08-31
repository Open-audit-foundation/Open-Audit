import { describe, it, expect } from "vitest";
import {
  decodeScValFromHex,
  decodeGenericEventPayload,
  formatGenericValue,
  type GenericDecodedValue,
} from "./generic-fallback-decoder";
import type { RawEvent } from "./types";

/**
 * Tests for the Generic Fallback XDR Decoder
 */

describe("decodeScValFromHex", () => {
  describe("Bool (type 0)", () => {
    it("decodes a true boolean", () => {
      // Type 0 (bool) + 4 bytes padding + 01 (true)
      const hex = "0x0000000000000001";
      const result = decodeScValFromHex(hex);
      expect(result).toBeDefined();
      expect(result?.type).toBe("bool");
      expect(result?.value).toBe(true);
    });

    it("decodes a false boolean", () => {
      const hex = "0x0000000000000000";
      const result = decodeScValFromHex(hex);
      expect(result).toBeDefined();
      expect(result?.type).toBe("bool");
      expect(result?.value).toBe(false);
    });
  });

  describe("U32 (type 3)", () => {
    it("decodes a simple U32", () => {
      // Type 3 (u32) + value 42
      const hex = "0x0000000300000002a";
      const result = decodeScValFromHex(hex);
      expect(result).toBeDefined();
      expect(result?.type).toBe("u32");
      expect(result?.value).toBe(0x0000002a);
    });

    it("decodes U32 max value", () => {
      // Type 3 + 0xFFFFFFFF
      const hex = "0x00000003ffffffff";
      const result = decodeScValFromHex(hex);
      expect(result).toBeDefined();
      expect(result?.type).toBe("u32");
      expect(result?.value).toBe(0xffffffff);
    });
  });

  describe("I32 (type 4)", () => {
    it("decodes a positive I32", () => {
      // Type 4 (i32) + value 100
      const hex = "0x0000000400000064";
      const result = decodeScValFromHex(hex);
      expect(result).toBeDefined();
      expect(result?.type).toBe("i32");
      expect(result?.value).toBe(100);
    });

    it("decodes a negative I32", () => {
      // Type 4 + -1 (0xFFFFFFFF in two's complement)
      const hex = "0x00000004ffffffff";
      const result = decodeScValFromHex(hex);
      expect(result).toBeDefined();
      expect(result?.type).toBe("i32");
      expect(result?.value).toBe(-1);
    });
  });

  describe("String (type 14)", () => {
    it("decodes a simple ASCII string", () => {
      // Type 14 (string) + length 5 + "Hello"
      // Length is encoded as 0x00000005
      // "Hello" = 0x48656c6c6f
      const hex = "0x0e000000054865" + "6c6c6f";
      const result = decodeScValFromHex(hex);
      expect(result).toBeDefined();
      expect(result?.type).toBe("string");
      expect(result?.value).toBe("Hello");
    });

    it("decodes empty string", () => {
      // Type 14 + length 0
      const hex = "0x0e00000000";
      const result = decodeScValFromHex(hex);
      expect(result).toBeDefined();
      expect(result?.type).toBe("string");
      expect(result?.value).toBe("");
    });
  });

  describe("Bytes (type 13)", () => {
    it("decodes bytes", () => {
      // Type 13 (bytes) + length 4 + data
      const hex = "0x0d000000040102030405";
      const result = decodeScValFromHex(hex);
      expect(result).toBeDefined();
      expect(result?.type).toBe("bytes");
      // Should have value and hex field
      expect(result?.value).toBeTruthy();
      expect(result?.hex).toBeTruthy();
    });
  });

  describe("Vec (type 16)", () => {
    it("decodes an empty vector", () => {
      // Type 16 (vec) + length 0
      const hex = "0x1000000000";
      const result = decodeScValFromHex(hex);
      expect(result).toBeDefined();
      expect(result?.type).toBe("vec");
      expect(Array.isArray(result?.value)).toBe(true);
      expect((result?.value as unknown[]).length).toBe(0);
    });
  });

  describe("Map (type 17)", () => {
    it("decodes an empty map", () => {
      // Type 17 (map) + length 0
      const hex = "0x1100000000";
      const result = decodeScValFromHex(hex);
      expect(result).toBeDefined();
      expect(result?.type).toBe("map");
      expect(typeof result?.value).toBe("object");
      expect(Object.keys(result?.value as Record<string, unknown>).length).toBe(0);
    });
  });

  describe("Error handling", () => {
    it("handles invalid hex gracefully", () => {
      const result = decodeScValFromHex("notvalidhex");
      expect(result).toBeDefined();
      expect(result?.type).toBe("unknown");
    });

    it("handles empty hex", () => {
      const result = decodeScValFromHex("");
      expect(result).toBeNull();
    });

    it("handles unknown type discriminants", () => {
      // Type 99 (unknown)
      const hex = "0x00000063";
      const result = decodeScValFromHex(hex);
      expect(result).toBeDefined();
      expect(result?.type).toBe("unknown");
    });

    it("handles hex with 0x prefix", () => {
      const hex = "0x0000000300000064";
      const result = decodeScValFromHex(hex);
      expect(result).toBeDefined();
      expect(result?.type).toBe("u32");
    });

    it("handles hex without 0x prefix", () => {
      const hex = "0000000300000064";
      const result = decodeScValFromHex(hex);
      expect(result).toBeDefined();
      expect(result?.type).toBe("u32");
    });
  });

  describe("Void (type 1)", () => {
    it("decodes void", () => {
      const hex = "0x0000000100000000";
      const result = decodeScValFromHex(hex);
      expect(result).toBeDefined();
      expect(result?.type).toBe("void");
      expect(result?.value).toBeNull();
    });
  });

  describe("U64 (type 5)", () => {
    it("decodes a U64", () => {
      // Type 5 + 8-byte value
      const hex = "0x000000050000000000000064"; // value = 100
      const result = decodeScValFromHex(hex);
      expect(result).toBeDefined();
      expect(result?.type).toBe("u64");
      expect(result?.value).toBe("100");
    });
  });

  describe("I64 (type 6)", () => {
    it("decodes a positive I64", () => {
      const hex = "0x000000060000000000000064"; // value = 100
      const result = decodeScValFromHex(hex);
      expect(result).toBeDefined();
      expect(result?.type).toBe("i64");
      expect(result?.value).toBe("100");
    });
  });
});

describe("decodeGenericEventPayload", () => {
  it("decodes a simple event with U32 data", () => {
    const event: RawEvent = {
      id: "test-1",
      contractId: "CTESTCONTRACT",
      topics: ["0x0000000000000000"],
      data: "0x0000000300000064",
      ledger: 1000,
      timestamp: Math.floor(Date.now() / 1000),
      txHash: "abc123",
    };

    const result = decodeGenericEventPayload(event);
    expect(result).toBeDefined();
  });

  it("handles empty data gracefully", () => {
    const event: RawEvent = {
      id: "test-2",
      contractId: "CTESTCONTRACT",
      topics: [],
      data: "",
      ledger: 1000,
      timestamp: Math.floor(Date.now() / 1000),
      txHash: "abc123",
    };

    const result = decodeGenericEventPayload(event);
    expect(result).toBeDefined();
  });

  it("handles invalid hex data gracefully", () => {
    const event: RawEvent = {
      id: "test-3",
      contractId: "CTESTCONTRACT",
      topics: [],
      data: "0xinvalidhex",
      ledger: 1000,
      timestamp: Math.floor(Date.now() / 1000),
      txHash: "abc123",
    };

    const result = decodeGenericEventPayload(event);
    expect(result).toBeDefined();
    // Should return a fallback structure
    expect(result).toHaveProperty("type");
  });
});

describe("formatGenericValue", () => {
  it("formats null", () => {
    expect(formatGenericValue(null)).toBe("null");
  });

  it("formats boolean", () => {
    expect(formatGenericValue(true)).toBe("true");
    expect(formatGenericValue(false)).toBe("false");
  });

  it("formats number", () => {
    expect(formatGenericValue(42)).toBe("42");
  });

  it("formats string", () => {
    expect(formatGenericValue("hello")).toBe("hello");
  });

  it("truncates long string", () => {
    const longString = "a".repeat(150);
    const result = formatGenericValue(longString);
    expect(result.length).toBeLessThan(longString.length);
    expect(result).toContain("…");
  });

  it("formats empty array", () => {
    expect(formatGenericValue([])).toBe("[]");
  });

  it("formats small array", () => {
    const result = formatGenericValue([1, 2, 3]);
    expect(result).toContain("[");
    expect(result).toContain("]");
  });

  it("truncates large array", () => {
    const largeArray = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const result = formatGenericValue(largeArray);
    expect(result).toContain("…");
  });

  it("formats empty object", () => {
    expect(formatGenericValue({})).toBe("{}");
  });

  it("formats object", () => {
    const result = formatGenericValue({ a: 1, b: "hello" });
    expect(result).toContain("{");
    expect(result).toContain("}");
  });

  it("handles nested objects", () => {
    const obj = { outer: { inner: "value" } };
    const result = formatGenericValue(obj);
    expect(result).toBeTruthy();
  });
});
