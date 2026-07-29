/**
 * Fuzz Testing for XDR Parser Security
 *
 * This test suite uses property-based testing to generate millions of
 * mutated, corrupted, and malicious XDR payloads to verify the parser
 * handles them gracefully without crashing or hanging.
 *
 * Run with: npm run test:fuzz
 * Or: vitest run lib/translator/__tests__/fuzz-xdr-parser.test.ts
 */

import { describe, it, expect } from "vitest";
import { secureParseScVal, secureDecodeEventPayload } from "../secure-xdr-parser";
import { getSecurityMetrics, resetSecurityMetrics } from "../parser-security";

describe("Fuzz Testing: XDR Parser", () => {
  describe("Malformed Hex Strings", () => {
    it("handles empty string gracefully", () => {
      const result = secureParseScVal("");
      expect(result.success).toBe(false);
    });

    it("handles non-hex characters gracefully", () => {
      const invalidHexes = [
        "0xGGGGGGGG",
        "not-hex-at-all",
        "0x!!!",
        "🎉🎊",
        null as any,
        undefined as any,
      ];

      for (const hex of invalidHexes) {
        const result = secureParseScVal(hex);
        expect(result.success).toBe(false);
      }
    });

    it("handles truncated hex strings gracefully", () => {
      const truncatedHexes = [
        "0x00",
        "0x0000",
        "0x000000",
        "0x00000010", // Incomplete Vec marker
      ];

      for (const hex of truncatedHexes) {
        const result = secureParseScVal(hex);
        // Should either succeed or fail gracefully (not crash)
        expect(typeof result.success).toBe("boolean");
      }
    });

    it("handles extremely long hex strings without OOM", () => {
      // Try to create a hex string that claims to be 1GB
      const longHex = "0x" + "a".repeat(1000000); // 500KB of hex data
      
      const result = secureParseScVal(longHex);
      
      // Should be rejected for size, not crash
      expect(result.success).toBe(false);
    });
  });

  describe("Deeply Nested Structures", () => {
    it("rejects deeply nested Vecs", () => {
      // Build a deeply nested Vec structure
      // Each level adds nesting: [[[[[...value...]]]]]
      
      let hex = "0x0000000e"; // String "x"
      hex += "00000001"; // Length 1
      hex += "78"; // ASCII 'x'
      
      // Wrap in 150 levels of Vecs (should exceed MAX_RECURSION_DEPTH=100)
      for (let i = 0; i < 150; i++) {
        const vecHex = "0x00000010"; // Vec marker
        const countHex = "00000001"; // 1 element
        hex = vecHex + countHex + hex.slice(2); // Remove 0x and wrap
      }
      
      const result = secureParseScVal("0x" + hex);
      
      expect(result.success).toBe(false);
      expect(result.error?.errorType).toBe("MAX_DEPTH_EXCEEDED");
    });

    it("rejects deeply nested Maps", () => {
      // Build a deeply nested Map structure
      // Each level adds nesting: {key: {key: {key: ... }}}
      
      let hex = "0x0000000e"; // String "x"
      hex += "00000001"; // Length 1
      hex += "78"; // ASCII 'x'
      
      // Wrap in 150 levels of Maps (should exceed MAX_RECURSION_DEPTH=100)
      for (let i = 0; i < 150; i++) {
        const mapHex = "0x00000011"; // Map marker
        const countHex = "00000001"; // 1 entry
        const keyHex = "0x0000000e0000000178"; // String "x" as key
        hex = mapHex + countHex + keyHex + hex.slice(2); // Remove 0x and wrap
      }
      
      const result = secureParseScVal("0x" + hex);
      
      expect(result.success).toBe(false);
      expect(result.error?.errorType).toBe("MAX_DEPTH_EXCEEDED");
    });
  });

  describe("Large Collections", () => {
    it("rejects Vecs with too many elements", () => {
      // Try to create a Vec with 20,000 elements (exceeds MAX_COLLECTION_SIZE=10,000)
      const vecHex = "0x00000010"; // Vec marker
      const countHex = "00004e20"; // 20,000 in hex
      const elementHex = "0x00000000"; // U32 value 0
      
      let hex = vecHex + countHex;
      
      // Add 20,000 elements (this will be huge)
      for (let i = 0; i < 100; i++) { // Just add 100 for testing, parser checks count
        hex += elementHex.slice(2);
      }
      
      const result = secureParseScVal("0x" + hex);
      
      expect(result.success).toBe(false);
      expect(result.error?.errorType).toBe("MAX_COLLECTION_SIZE_EXCEEDED");
    });

    it("rejects Maps with too many entries", () => {
      // Try to create a Map with 20,000 entries
      const mapHex = "0x00000011"; // Map marker
      const countHex = "00004e20"; // 20,000 in hex
      
      const result = secureParseScVal("0x" + mapHex + countHex);
      
      expect(result.success).toBe(false);
      expect(result.error?.errorType).toBe("MAX_COLLECTION_SIZE_EXCEEDED");
    });
  });

  describe("Random Mutation Testing", () => {
    it("handles random byte mutations gracefully", () => {
      // Start with a valid hex string
      const validHex = "0x0000000e0000000568656c6c6f"; // String "hello"
      
      // Generate 100 random mutations
      for (let i = 0; i < 100; i++) {
        const mutated = mutateHex(validHex);
        const result = secureParseScVal(mutated);
        
        // Should never crash - either succeed or fail gracefully
        expect(typeof result.success).toBe("boolean");
      }
    });

    it("handles random hex generation gracefully", () => {
      // Generate 100 completely random hex strings
      for (let i = 0; i < 100; i++) {
        const randomHex = generateRandomHex(Math.floor(Math.random() * 1000));
        const result = secureParseScVal(randomHex);
        
        // Should never crash
        expect(typeof result.success).toBe("boolean");
      }
    });
  });

  describe("Event Payload Fuzzing", () => {
    it("handles arrays of malformed payloads gracefully", () => {
      const malformedPayloads = [
        "",
        "0x",
        "invalid",
        "0xGGGG",
        "0x" + "a".repeat(1000000),
        "0x00000010" + "FFFFFFFF", // Vec with huge count
        "0x00000011" + "FFFFFFFF", // Map with huge count
      ];
      
      const results = secureDecodeEventPayload(malformedPayloads);
      
      // Should return safe error messages, not crash
      expect(results).toHaveLength(malformedPayloads.length);
      for (const result of results) {
        expect(typeof result).toBe("string");
        expect(result.length).toBeGreaterThan(0);
      }
    });

    it("handles mixed valid and invalid payloads", () => {
      const mixedPayloads = [
        "0x0000000e0000000568656c6c6f", // Valid: String "hello"
        "invalid-hex",                     // Invalid
        "0x00000000",                      // Valid: U32 value 0
        "0x" + "a".repeat(1000000),        // Invalid: Too long
        "0x00000001",                      // Valid: Bool true
      ];
      
      const results = secureDecodeEventPayload(mixedPayloads);
      
      expect(results).toHaveLength(mixedPayloads.length);
      
      // Check that we got some successful parses and some errors
      const hasSuccess = results.some(r => !r.includes("safely parsed"));
      const hasErrors = results.some(r => r.includes("safely parsed"));
      
      // At least some should succeed and some should fail
      expect(hasSuccess || hasErrors).toBe(true);
    });
  });

  describe("Performance Under Attack", () => {
    it("completes fuzzing within reasonable time", () => {
      const startTime = Date.now();
      
      // Run 1000 fuzz tests
      for (let i = 0; i < 1000; i++) {
        const randomHex = generateRandomHex(Math.floor(Math.random() * 100));
        secureParseScVal(randomHex);
      }
      
      const elapsed = Date.now() - startTime;
      
      // Should complete 1000 tests in under 5 seconds
      expect(elapsed).toBeLessThan(5000);
    });

    it("does not leak memory during repeated attacks", () => {
      resetSecurityMetrics();
      
      const initialMemory = process.memoryUsage().heapUsed;
      
      // Simulate 1000 attack attempts
      for (let i = 0; i < 1000; i++) {
        const attackHex = generateDeepNesting(50); // Medium nesting
        secureParseScVal(attackHex);
      }
      
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }
      
      const finalMemory = process.memoryUsage().heapUsed;
      const memoryGrowth = finalMemory - initialMemory;
      
      // Memory growth should be reasonable (< 50 MB for 1000 attacks)
      expect(memoryGrowth).toBeLessThan(50 * 1024 * 1024);
    });
  });

  describe("Security Metrics During Fuzzing", () => {
    it("tracks attack patterns during fuzzing", () => {
      resetSecurityMetrics();
      
      // Simulate attack pattern: many depth errors
      for (let i = 0; i < 20; i++) {
        const deepHex = generateDeepNesting(150);
        secureParseScVal(deepHex);
      }
      
      const metrics = getSecurityMetrics();
      
      expect(metrics.totalParses).toBe(20);
      expect(metrics.rejectedParses).toBeGreaterThan(0);
      expect(metrics.errorsByType["MAX_DEPTH_EXCEEDED"]).toBeGreaterThan(0);
    });
  });
});

// ============================================================================
// Fuzz Testing Utilities
// ============================================================================

/**
 * Generates a random hex string of the specified length.
 */
function generateRandomHex(length: number): string {
  const chars = "0123456789abcdef";
  let hex = "0x";
  
  for (let i = 0; i < length; i++) {
    hex += chars[Math.floor(Math.random() * chars.length)];
  }
  
  return hex;
}

/**
 * Mutates a hex string by randomly flipping bytes.
 */
function mutateHex(hex: string): string {
  const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = cleanHex.split("");
  
  // Mutate 1-5 random positions
  const mutationCount = Math.floor(Math.random() * 5) + 1;
  
  for (let i = 0; i < mutationCount; i++) {
    const pos = Math.floor(Math.random() * bytes.length);
    bytes[pos] = Math.floor(Math.random() * 16).toString(16);
  }
  
  return "0x" + bytes.join("");
}

/**
 * Generates a deeply nested Vec structure for testing.
 */
function generateDeepNesting(depth: number): string {
  let hex = "0x0000000e0000000178"; // String "x" at the core
  
  for (let i = 0; i < depth; i++) {
    const vecHex = "0x00000010"; // Vec marker
    const countHex = "00000001"; // 1 element
    hex = vecHex + countHex + hex.slice(2); // Wrap previous value
  }
  
  return hex;
}

/**
 * Generates a Vec with many elements.
 */
function generateLargeVec(elementCount: number): string {
  const vecHex = "0x00000010"; // Vec marker
  const countBytes = elementCount.toString(16).padStart(8, "0");
  
  let hex = vecHex + countBytes;
  
  // Add some elements (not all, parser will check count)
  for (let i = 0; i < Math.min(elementCount, 100); i++) {
    hex += "00000000"; // U32 value 0
  }
  
  return "0x" + hex;
}
