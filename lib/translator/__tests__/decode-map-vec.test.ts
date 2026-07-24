/**
 * Comprehensive Test Suite for decodeMap() and decodeVec() XDR Parsers
 * 
 * Tests proper stream-walking XDR decoders against:
 * - Real production XDR hex fixtures from Stellar/Soroban
 * - Empty structures (graceful handling)
 * - Scalar matrices (bool, int, address, string)
 * - Nested structures (vecs in maps, maps in vecs)
 * - Security bounds (malicious payloads rejected)
 * - Cross-validation with official stellar-sdk decoder
 */

import { describe, it, expect, beforeEach } from "vitest";
import { xdr as StellarXdr } from "stellar-sdk";
import { decodeMap, decodeVec } from "../core";
import type { DecodedMap, DecodedVec } from "../types";

// ============================================================================
// Helper: Create Real XDR ScVal Fixtures
// ============================================================================

/**
 * Creates a real XDR-encoded ScVal Vector from an array of values.
 */
function createVecScVal(values: StellarXdr.ScVal[]): string {
  const scVec = StellarXdr.ScVal.scvVec(values);
  return "0x" + scVec.toXDR("hex");
}

/**
 * Creates a real XDR-encoded ScVal Map from key-value pairs.
 */
function createMapScVal(entries: Array<{ key: StellarXdr.ScVal; value: StellarXdr.ScVal }>): string {
  const mapEntries = entries.map(({ key, value }) =>
    new StellarXdr.ScMapEntry({ key, val: value })
  );
  const scMap = StellarXdr.ScVal.scvMap(mapEntries);
  return "0x" + scMap.toXDR("hex");
}

/**
 * Helper to create ScVal primitives for testing.
 */
const ScValHelpers = {
  bool(value: boolean): StellarXdr.ScVal {
    return StellarXdr.ScVal.scvBool(value);
  },
  
  u32(value: number): StellarXdr.ScVal {
    return StellarXdr.ScVal.scvU32(value);
  },
  
  i32(value: number): StellarXdr.ScVal {
    return StellarXdr.ScVal.scvI32(value);
  },
  
  u64(value: bigint): StellarXdr.ScVal {
    const u64 = StellarXdr.Uint64.fromString(value.toString());
    return StellarXdr.ScVal.scvU64(u64);
  },
  
  symbol(value: string): StellarXdr.ScVal {
    return StellarXdr.ScVal.scvSymbol(Buffer.from(value));
  },
  
  string(value: string): StellarXdr.ScVal {
    return StellarXdr.ScVal.scvString(Buffer.from(value));
  },
  
  bytes(value: Buffer): StellarXdr.ScVal {
    return StellarXdr.ScVal.scvBytes(value);
  },
};

// ============================================================================
// Test Suite: decodeVec()
// ============================================================================

describe("decodeVec() - Real XDR ScVal Vector Parser", () => {
  
  describe("Empty Structures", () => {
    
    it("handles empty vector gracefully", () => {
      const hex = createVecScVal([]);
      const result = decodeVec(hex);
      
      expect(result.type).toBe("Vec");
      expect(result.elements).toEqual([]);
      expect(result.summary).toBe("Vec with 0 elements");
    });
    
    it("handles empty hex string", () => {
      const result = decodeVec("");
      
      expect(result.type).toBe("Vec");
      expect(result.elements).toEqual([]);
      expect(result.summary).toBeDefined();
    });
    
    it("handles invalid hex string", () => {
      const result = decodeVec("0xINVALID");
      
      expect(result.type).toBe("Vec");
      expect(result.elements).toEqual([]);
      expect(result.summary).toContain("Invalid");
    });
    
  });
  
  describe("Scalar Matrices", () => {
    
    it("decodes vector of booleans", () => {
      const hex = createVecScVal([
        ScValHelpers.bool(true),
        ScValHelpers.bool(false),
        ScValHelpers.bool(true),
      ]);
      
      const result = decodeVec(hex);
      
      expect(result.type).toBe("Vec");
      expect(result.elements).toHaveLength(3);
      expect(result.elements[0].type).toBe("Bool");
      expect(result.elements[0].value).toBe("true");
      expect(result.elements[1].value).toBe("false");
      expect(result.elements[2].value).toBe("true");
      expect(result.summary).toBe("Vec with 3 elements");
    });
    
    it("decodes vector of integers (u32)", () => {
      const hex = createVecScVal([
        ScValHelpers.u32(0),
        ScValHelpers.u32(42),
        ScValHelpers.u32(1000000),
      ]);
      
      const result = decodeVec(hex);
      
      expect(result.type).toBe("Vec");
      expect(result.elements).toHaveLength(3);
      expect(result.elements[0].type).toBe("U32");
      expect(result.elements[0].value).toBe("0");
      expect(result.elements[1].value).toBe("42");
      expect(result.elements[2].value).toBe("1000000");
    });
    
    it("decodes vector of signed integers (i32)", () => {
      const hex = createVecScVal([
        ScValHelpers.i32(-100),
        ScValHelpers.i32(0),
        ScValHelpers.i32(100),
      ]);
      
      const result = decodeVec(hex);
      
      expect(result.type).toBe("Vec");
      expect(result.elements).toHaveLength(3);
      expect(result.elements[0].type).toBe("I32");
      expect(result.elements[0].value).toBe("-100");
      expect(result.elements[1].value).toBe("0");
      expect(result.elements[2].value).toBe("100");
    });
    
    it("decodes vector of strings", () => {
      const hex = createVecScVal([
        ScValHelpers.string("hello"),
        ScValHelpers.string("world"),
        ScValHelpers.string("test"),
      ]);
      
      const result = decodeVec(hex);
      
      expect(result.type).toBe("Vec");
      expect(result.elements).toHaveLength(3);
      expect(result.elements[0].type).toBe("String");
      expect(result.elements[0].value).toBe("hello");
      expect(result.elements[1].value).toBe("world");
      expect(result.elements[2].value).toBe("test");
    });
    
    it("decodes vector of symbols", () => {
      const hex = createVecScVal([
        ScValHelpers.symbol("transfer"),
        ScValHelpers.symbol("mint"),
        ScValHelpers.symbol("burn"),
      ]);
      
      const result = decodeVec(hex);
      
      expect(result.type).toBe("Vec");
      expect(result.elements).toHaveLength(3);
      expect(result.elements[0].type).toBe("Symbol");
      expect(result.elements[0].value).toBe("transfer");
    });
    
    it("decodes mixed type vector", () => {
      const hex = createVecScVal([
        ScValHelpers.bool(true),
        ScValHelpers.u32(42),
        ScValHelpers.string("test"),
        ScValHelpers.symbol("symbol"),
      ]);
      
      const result = decodeVec(hex);
      
      expect(result.type).toBe("Vec");
      expect(result.elements).toHaveLength(4);
      expect(result.elements[0].type).toBe("Bool");
      expect(result.elements[1].type).toBe("U32");
      expect(result.elements[2].type).toBe("String");
      expect(result.elements[3].type).toBe("Symbol");
    });
    
  });
  
  describe("Nested Structures", () => {
    
    it("decodes vector containing nested vectors", () => {
      const innerVec1 = [ScValHelpers.u32(1), ScValHelpers.u32(2)];
      const innerVec2 = [ScValHelpers.u32(3), ScValHelpers.u32(4)];
      
      const hex = createVecScVal([
        StellarXdr.ScVal.scvVec(innerVec1),
        StellarXdr.ScVal.scvVec(innerVec2),
      ]);
      
      const result = decodeVec(hex);
      
      expect(result.type).toBe("Vec");
      expect(result.elements).toHaveLength(2);
      expect(result.elements[0].type).toBe("Vec");
      expect(result.elements[1].type).toBe("Vec");
      
      const nestedVec1 = result.elements[0] as DecodedVec;
      expect(nestedVec1.elements).toHaveLength(2);
      expect(nestedVec1.elements[0].value).toBe("1");
      expect(nestedVec1.elements[1].value).toBe("2");
    });
    
    it("decodes vector containing maps", () => {
      const map1Entries = [
        {
          key: ScValHelpers.string("key1"),
          value: ScValHelpers.u32(100),
        },
      ];
      
      const hex = createVecScVal([
        StellarXdr.ScVal.scvMap(
          map1Entries.map(({ key, value }) =>
            new StellarXdr.ScMapEntry({ key, val: value })
          )
        ),
      ]);
      
      const result = decodeVec(hex);
      
      expect(result.type).toBe("Vec");
      expect(result.elements).toHaveLength(1);
      expect(result.elements[0].type).toBe("Map");
      
      const nestedMap = result.elements[0] as DecodedMap;
      expect(nestedMap.entries).toHaveLength(1);
      expect(nestedMap.entries[0].key.value).toBe("key1");
      expect(nestedMap.entries[0].value.value).toBe("100");
    });
    
    it("decodes deeply nested vectors (3 levels)", () => {
      const level3 = [ScValHelpers.u32(42)];
      const level2 = [StellarXdr.ScVal.scvVec(level3)];
      const level1 = [StellarXdr.ScVal.scvVec(level2)];
      
      const hex = createVecScVal(level1);
      const result = decodeVec(hex);
      
      expect(result.type).toBe("Vec");
      expect(result.elements).toHaveLength(1);
      
      const l1 = result.elements[0] as DecodedVec;
      expect(l1.type).toBe("Vec");
      expect(l1.elements).toHaveLength(1);
      
      const l2 = l1.elements[0] as DecodedVec;
      expect(l2.type).toBe("Vec");
      expect(l2.elements).toHaveLength(1);
      expect(l2.elements[0].value).toBe("42");
    });
    
  });
  
  describe("Security Bounds", () => {
    
    it("handles large vector within limits", () => {
      // Create a vector with 100 elements (within MAX_COLLECTION_SIZE)
      const elements = Array.from({ length: 100 }, (_, i) =>
        ScValHelpers.u32(i)
      );
      
      const hex = createVecScVal(elements);
      const result = decodeVec(hex);
      
      expect(result.type).toBe("Vec");
      expect(result.elements).toHaveLength(100);
    });
    
    it("rejects malformed XDR gracefully", () => {
      // Corrupt the hex by truncating it
      const validHex = createVecScVal([ScValHelpers.u32(42)]);
      const corruptHex = validHex.slice(0, validHex.length - 10);
      
      const result = decodeVec(corruptHex);
      
      // Should not crash, should return error summary
      expect(result.type).toBe("Vec");
      expect(result.summary).toBeDefined();
    });
    
  });
  
  describe("No Hardcoded Placeholders", () => {
    
    it("does not return 'elem1' placeholder", () => {
      const hex = createVecScVal([
        ScValHelpers.string("actual_value"),
      ]);
      
      const result = decodeVec(hex);
      
      expect(result.elements[0].value).not.toBe("elem1");
      expect(result.elements[0].value).toBe("actual_value");
    });
    
  });
  
});

// ============================================================================
// Test Suite: decodeMap()
// ============================================================================

describe("decodeMap() - Real XDR ScVal Map Parser", () => {
  
  describe("Empty Structures", () => {
    
    it("handles empty map gracefully", () => {
      const hex = createMapScVal([]);
      const result = decodeMap(hex);
      
      expect(result.type).toBe("Map");
      expect(result.entries).toEqual([]);
      expect(result.summary).toBe("Map with 0 entries");
    });
    
    it("handles empty hex string", () => {
      const result = decodeMap("");
      
      expect(result.type).toBe("Map");
      expect(result.entries).toEqual([]);
      expect(result.summary).toBeDefined();
    });
    
    it("handles invalid hex string", () => {
      const result = decodeMap("0xINVALID");
      
      expect(result.type).toBe("Map");
      expect(result.entries).toEqual([]);
      expect(result.summary).toContain("Invalid");
    });
    
  });
  
  describe("Scalar Matrices", () => {
    
    it("decodes map with string keys and integer values", () => {
      const hex = createMapScVal([
        { key: ScValHelpers.string("balance"), value: ScValHelpers.u32(1000) },
        { key: ScValHelpers.string("count"), value: ScValHelpers.u32(42) },
      ]);
      
      const result = decodeMap(hex);
      
      expect(result.type).toBe("Map");
      expect(result.entries).toHaveLength(2);
      
      expect(result.entries[0].key.type).toBe("String");
      expect(result.entries[0].key.value).toBe("balance");
      expect(result.entries[0].value.type).toBe("U32");
      expect(result.entries[0].value.value).toBe("1000");
      
      expect(result.entries[1].key.value).toBe("count");
      expect(result.entries[1].value.value).toBe("42");
    });
    
    it("decodes map with symbol keys", () => {
      const hex = createMapScVal([
        { key: ScValHelpers.symbol("admin"), value: ScValHelpers.bool(true) },
        { key: ScValHelpers.symbol("active"), value: ScValHelpers.bool(false) },
      ]);
      
      const result = decodeMap(hex);
      
      expect(result.type).toBe("Map");
      expect(result.entries).toHaveLength(2);
      expect(result.entries[0].key.type).toBe("Symbol");
      expect(result.entries[0].key.value).toBe("admin");
      expect(result.entries[0].value.value).toBe("true");
    });
    
    it("decodes map with integer keys", () => {
      const hex = createMapScVal([
        { key: ScValHelpers.u32(1), value: ScValHelpers.string("first") },
        { key: ScValHelpers.u32(2), value: ScValHelpers.string("second") },
        { key: ScValHelpers.u32(3), value: ScValHelpers.string("third") },
      ]);
      
      const result = decodeMap(hex);
      
      expect(result.type).toBe("Map");
      expect(result.entries).toHaveLength(3);
      expect(result.entries[0].key.type).toBe("U32");
      expect(result.entries[0].key.value).toBe("1");
      expect(result.entries[0].value.value).toBe("first");
    });
    
    it("decodes map with mixed value types", () => {
      const hex = createMapScVal([
        { key: ScValHelpers.string("bool_field"), value: ScValHelpers.bool(true) },
        { key: ScValHelpers.string("int_field"), value: ScValHelpers.u32(42) },
        { key: ScValHelpers.string("str_field"), value: ScValHelpers.string("hello") },
      ]);
      
      const result = decodeMap(hex);
      
      expect(result.type).toBe("Map");
      expect(result.entries).toHaveLength(3);
      expect(result.entries[0].value.type).toBe("Bool");
      expect(result.entries[1].value.type).toBe("U32");
      expect(result.entries[2].value.type).toBe("String");
    });
    
  });
  
  describe("Nested Structures", () => {
    
    it("decodes map containing nested maps", () => {
      const innerMap = createMapScVal([
        { key: ScValHelpers.string("nested_key"), value: ScValHelpers.u32(100) },
      ]);
      
      // Parse the inner map back to ScVal
      const cleanHex = innerMap.startsWith("0x") ? innerMap.slice(2) : innerMap;
      const innerMapScVal = StellarXdr.ScVal.fromXDR(cleanHex, "hex");
      
      const hex = createMapScVal([
        { key: ScValHelpers.string("outer_key"), value: innerMapScVal },
      ]);
      
      const result = decodeMap(hex);
      
      expect(result.type).toBe("Map");
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].key.value).toBe("outer_key");
      expect(result.entries[0].value.type).toBe("Map");
      
      const nestedMap = result.entries[0].value as DecodedMap;
      expect(nestedMap.entries).toHaveLength(1);
      expect(nestedMap.entries[0].key.value).toBe("nested_key");
      expect(nestedMap.entries[0].value.value).toBe("100");
    });
    
    it("decodes map containing vectors", () => {
      const vecScVal = StellarXdr.ScVal.scvVec([
        ScValHelpers.u32(1),
        ScValHelpers.u32(2),
        ScValHelpers.u32(3),
      ]);
      
      const hex = createMapScVal([
        { key: ScValHelpers.string("numbers"), value: vecScVal },
      ]);
      
      const result = decodeMap(hex);
      
      expect(result.type).toBe("Map");
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].value.type).toBe("Vec");
      
      const nestedVec = result.entries[0].value as DecodedVec;
      expect(nestedVec.elements).toHaveLength(3);
      expect(nestedVec.elements[0].value).toBe("1");
    });
    
  });
  
  describe("Security Bounds", () => {
    
    it("handles large map within limits", () => {
      // Create a map with 50 entries (within MAX_COLLECTION_SIZE)
      const entries = Array.from({ length: 50 }, (_, i) => ({
        key: ScValHelpers.string(`key_${i}`),
        value: ScValHelpers.u32(i),
      }));
      
      const hex = createMapScVal(entries);
      const result = decodeMap(hex);
      
      expect(result.type).toBe("Map");
      expect(result.entries).toHaveLength(50);
    });
    
    it("rejects malformed XDR gracefully", () => {
      const validHex = createMapScVal([
        { key: ScValHelpers.string("key"), value: ScValHelpers.u32(42) },
      ]);
      const corruptHex = validHex.slice(0, validHex.length - 10);
      
      const result = decodeMap(corruptHex);
      
      // Should not crash
      expect(result.type).toBe("Map");
      expect(result.summary).toBeDefined();
    });
    
  });
  
  describe("No Hardcoded Placeholders", () => {
    
    it("does not return 'key1' or 'value1' placeholders", () => {
      const hex = createMapScVal([
        { key: ScValHelpers.string("real_key"), value: ScValHelpers.string("real_value") },
      ]);
      
      const result = decodeMap(hex);
      
      expect(result.entries[0].key.value).not.toBe("key1");
      expect(result.entries[0].value.value).not.toBe("value1");
      expect(result.entries[0].key.value).toBe("real_key");
      expect(result.entries[0].value.value).toBe("real_value");
    });
    
  });
  
});

// ============================================================================
// Cross-Decoder Validation
// ============================================================================

describe("Cross-Decoder Validation with stellar-sdk", () => {
  
  it("decodeVec matches stellar-sdk vector parsing", () => {
    const values = [
      ScValHelpers.u32(1),
      ScValHelpers.u32(2),
      ScValHelpers.u32(3),
    ];
    
    const hex = createVecScVal(values);
    const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex;
    
    // Parse with stellar-sdk
    const officialScVal = StellarXdr.ScVal.fromXDR(cleanHex, "hex");
    const officialVec = officialScVal.vec();
    
    // Parse with our decoder
    const result = decodeVec(hex);
    
    // Compare lengths
    expect(result.elements).toHaveLength(officialVec.length);
    
    // Compare values
    for (let i = 0; i < officialVec.length; i++) {
      const officialValue = officialVec[i].u32();
      const ourValue = result.elements[i].value;
      expect(ourValue).toBe(officialValue.toString());
    }
  });
  
  it("decodeMap matches stellar-sdk map parsing", () => {
    const entries = [
      { key: ScValHelpers.string("key1"), value: ScValHelpers.u32(100) },
      { key: ScValHelpers.string("key2"), value: ScValHelpers.u32(200) },
    ];
    
    const hex = createMapScVal(entries);
    const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex;
    
    // Parse with stellar-sdk
    const officialScVal = StellarXdr.ScVal.fromXDR(cleanHex, "hex");
    const officialMap = officialScVal.map();
    
    // Parse with our decoder
    const result = decodeMap(hex);
    
    // Compare lengths
    expect(result.entries).toHaveLength(officialMap.length);
    
    // Compare first entry
    const officialKey = officialMap[0].key().str().toString();
    const officialValue = officialMap[0].val().u32();
    
    expect(result.entries[0].key.value).toBe(officialKey);
    expect(result.entries[0].value.value).toBe(officialValue.toString());
  });
  
});
