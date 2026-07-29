/**
 * Integration tests for Secure XDR Parser
 *
 * These tests verify that the secure parser correctly handles real-world
 * XDR payloads while enforcing security constraints.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { xdr as StellarXdr } from "stellar-sdk";
import {
  secureParseScVal,
  secureScValToString,
  secureDecodeEventPayload,
  resetSecurityMetrics,
  getSecurityMetrics,
} from "../secure-xdr-parser";

describe("Secure XDR Parser - Integration Tests", () => {
  beforeEach(() => {
    resetSecurityMetrics();
  });

  describe("Valid XDR Parsing", () => {
    it("parses valid Bool ScVal", () => {
      const scVal = StellarXdr.ScVal.scvBool(true);
      const hex = scVal.toXDR("hex");
      
      const result = secureParseScVal("0x" + hex);
      
      expect(result.success).toBe(true);
      expect(result.value).toBeDefined();
      expect(result.value?.switch().name).toBe("scvBool");
    });

    it("parses valid U32 ScVal", () => {
      const scVal = StellarXdr.ScVal.scvU32(42);
      const hex = scVal.toXDR("hex");
      
      const result = secureParseScVal("0x" + hex);
      
      expect(result.success).toBe(true);
      expect(result.value?.u32()).toBe(42);
    });

    it("parses valid String ScVal", () => {
      const scVal = StellarXdr.ScVal.scvString("hello");
      const hex = scVal.toXDR("hex");
      
      const result = secureParseScVal("0x" + hex);
      
      expect(result.success).toBe(true);
      expect(result.value?.str().toString()).toBe("hello");
    });

    it("parses valid Symbol ScVal", () => {
      const scVal = StellarXdr.ScVal.scvSymbol("transfer");
      const hex = scVal.toXDR("hex");
      
      const result = secureParseScVal("0x" + hex);
      
      expect(result.success).toBe(true);
      expect(result.value?.sym().toString()).toBe("transfer");
    });

    it("parses valid Vec ScVal", () => {
      const scVal = StellarXdr.ScVal.scvVec([
        StellarXdr.ScVal.scvU32(1),
        StellarXdr.ScVal.scvU32(2),
        StellarXdr.ScVal.scvU32(3),
      ]);
      const hex = scVal.toXDR("hex");
      
      const result = secureParseScVal("0x" + hex);
      
      expect(result.success).toBe(true);
      expect(result.value?.vec()?.length).toBe(3);
    });

    it("parses valid Map ScVal", () => {
      const scVal = StellarXdr.ScVal.scvMap([
        new StellarXdr.ScMapEntry({
          key: StellarXdr.ScVal.scvSymbol("amount"),
          val: StellarXdr.ScVal.scvU32(100),
        }),
      ]);
      const hex = scVal.toXDR("hex");
      
      const result = secureParseScVal("0x" + hex);
      
      expect(result.success).toBe(true);
      expect(result.value?.map()?.length).toBe(1);
    });
  });

  describe("Nested Structure Parsing", () => {
    it("parses moderately nested Vec (depth 10)", () => {
      let scVal: StellarXdr.ScVal = StellarXdr.ScVal.scvU32(42);
      
      // Nest 10 levels deep
      for (let i = 0; i < 10; i++) {
        scVal = StellarXdr.ScVal.scvVec([scVal]);
      }
      
      const hex = scVal.toXDR("hex");
      const result = secureParseScVal("0x" + hex);
      
      expect(result.success).toBe(true);
    });

    it("parses moderately nested Map (depth 10)", () => {
      let scVal: StellarXdr.ScVal = StellarXdr.ScVal.scvU32(42);
      
      // Nest 10 levels deep
      for (let i = 0; i < 10; i++) {
        scVal = StellarXdr.ScVal.scvMap([
          new StellarXdr.ScMapEntry({
            key: StellarXdr.ScVal.scvSymbol("nested"),
            val: scVal,
          }),
        ]);
      }
      
      const hex = scVal.toXDR("hex");
      const result = secureParseScVal("0x" + hex);
      
      expect(result.success).toBe(true);
    });

    it("rejects excessively nested Vec (depth 150)", () => {
      let scVal: StellarXdr.ScVal = StellarXdr.ScVal.scvU32(42);
      
      // Nest 150 levels deep (exceeds MAX_RECURSION_DEPTH=100)
      for (let i = 0; i < 150; i++) {
        scVal = StellarXdr.ScVal.scvVec([scVal]);
      }
      
      const hex = scVal.toXDR("hex");
      const result = secureParseScVal("0x" + hex);
      
      expect(result.success).toBe(false);
      expect(result.error?.errorType).toBe("MAX_DEPTH_EXCEEDED");
    });
  });

  describe("ScVal to String Conversion", () => {
    it("converts Bool to string", () => {
      const scVal = StellarXdr.ScVal.scvBool(true);
      const result = secureScValToString(scVal);
      
      expect(result.success).toBe(true);
      expect(result.value).toBe("true");
    });

    it("converts U32 to string", () => {
      const scVal = StellarXdr.ScVal.scvU32(42);
      const result = secureScValToString(scVal);
      
      expect(result.success).toBe(true);
      expect(result.value).toBe("42");
    });

    it("converts String to string", () => {
      const scVal = StellarXdr.ScVal.scvString("hello");
      const result = secureScValToString(scVal);
      
      expect(result.success).toBe(true);
      expect(result.value).toBe("hello");
    });

    it("converts Vec to string", () => {
      const scVal = StellarXdr.ScVal.scvVec([
        StellarXdr.ScVal.scvU32(1),
        StellarXdr.ScVal.scvU32(2),
      ]);
      const result = secureScValToString(scVal);
      
      expect(result.success).toBe(true);
      expect(result.value).toBe("[1, 2]");
    });

    it("converts Map to string", () => {
      const scVal = StellarXdr.ScVal.scvMap([
        new StellarXdr.ScMapEntry({
          key: StellarXdr.ScVal.scvSymbol("amount"),
          val: StellarXdr.ScVal.scvU32(100),
        }),
      ]);
      const result = secureScValToString(scVal);
      
      expect(result.success).toBe(true);
      expect(result.value).toBe("{amount: 100}");
    });

    it("returns safe fallback for deeply nested structure", () => {
      let scVal: StellarXdr.ScVal = StellarXdr.ScVal.scvU32(42);
      
      // Nest 150 levels deep
      for (let i = 0; i < 150; i++) {
        scVal = StellarXdr.ScVal.scvVec([scVal]);
      }
      
      const result = secureScValToString(scVal);
      
      expect(result.success).toBe(false);
      expect(result.value).toContain("deeply nested");
    });
  });

  describe("Event Payload Decoding", () => {
    it("decodes array of valid payloads", () => {
      const payloads = [
        StellarXdr.ScVal.scvSymbol("transfer").toXDR("hex"),
        StellarXdr.ScVal.scvU32(100).toXDR("hex"),
        StellarXdr.ScVal.scvString("Alice").toXDR("hex"),
      ];
      
      const results = secureDecodeEventPayload(payloads.map(p => "0x" + p));
      
      expect(results).toHaveLength(3);
      expect(results[0]).toBe("transfer");
      expect(results[1]).toBe("100");
      expect(results[2]).toBe("Alice");
    });

    it("handles mixed valid and invalid payloads", () => {
      const payloads = [
        "0x" + StellarXdr.ScVal.scvU32(100).toXDR("hex"), // Valid
        "invalid-hex", // Invalid
        "0x" + StellarXdr.ScVal.scvString("test").toXDR("hex"), // Valid
      ];
      
      const results = secureDecodeEventPayload(payloads);
      
      expect(results).toHaveLength(3);
      expect(results[0]).toBe("100");
      expect(results[1]).toContain("malformed"); // Error message
      expect(results[2]).toBe("test");
    });

    it("returns safe error messages for malicious payloads", () => {
      // Create a deeply nested Vec
      let scVal: StellarXdr.ScVal = StellarXdr.ScVal.scvU32(42);
      for (let i = 0; i < 150; i++) {
        scVal = StellarXdr.ScVal.scvVec([scVal]);
      }
      
      const payloads = ["0x" + scVal.toXDR("hex")];
      const results = secureDecodeEventPayload(payloads);
      
      expect(results).toHaveLength(1);
      expect(results[0]).toContain("deeply nested");
      expect(results[0]).not.toContain("150"); // No technical details leaked
    });
  });

  describe("Security Metrics Tracking", () => {
    it("tracks successful parses", () => {
      const scVal = StellarXdr.ScVal.scvU32(42);
      const hex = "0x" + scVal.toXDR("hex");
      
      secureParseScVal(hex);
      
      const metrics = getSecurityMetrics();
      expect(metrics.totalParses).toBe(1);
      expect(metrics.successfulParses).toBe(1);
      expect(metrics.rejectedParses).toBe(0);
    });

    it("tracks rejected parses", () => {
      const invalidHex = "0xGGGGGGGG";
      
      secureParseScVal(invalidHex);
      
      const metrics = getSecurityMetrics();
      expect(metrics.totalParses).toBe(1);
      expect(metrics.successfulParses).toBe(0);
      expect(metrics.rejectedParses).toBe(1);
    });

    it("tracks error types", () => {
      // Create deeply nested structure
      let scVal: StellarXdr.ScVal = StellarXdr.ScVal.scvU32(42);
      for (let i = 0; i < 150; i++) {
        scVal = StellarXdr.ScVal.scvVec([scVal]);
      }
      
      secureParseScVal("0x" + scVal.toXDR("hex"));
      
      const metrics = getSecurityMetrics();
      expect(metrics.errorsByType["MAX_DEPTH_EXCEEDED"]).toBe(1);
    });
  });

  describe("Real-World Event Simulation", () => {
    it("handles typical Stellar Asset Contract transfer event", () => {
      // Simulate a transfer event with topics + data
      const topics = [
        StellarXdr.ScVal.scvSymbol("transfer").toXDR("hex"),
        // from address (mock)
        StellarXdr.ScVal.scvU32(100).toXDR("hex"),
        // to address (mock)
        StellarXdr.ScVal.scvU32(200).toXDR("hex"),
      ];
      
      // amount in data
      const data = StellarXdr.ScVal.scvI128(
        new StellarXdr.Int128Parts({
          hi: StellarXdr.Int64.fromString("0"),
          lo: StellarXdr.Uint64.fromString("1000000"),
        })
      ).toXDR("hex");
      
      const payloads = [...topics, data].map(p => "0x" + p);
      const results = secureDecodeEventPayload(payloads);
      
      expect(results).toHaveLength(4);
      expect(results[0]).toBe("transfer");
      expect(results[3]).toBe("1000000");
    });

    it("handles complex struct with nested Map and Vec", () => {
      // Simulate a complex struct: { params: { amounts: [100, 200, 300] } }
      const amounts = StellarXdr.ScVal.scvVec([
        StellarXdr.ScVal.scvU32(100),
        StellarXdr.ScVal.scvU32(200),
        StellarXdr.ScVal.scvU32(300),
      ]);
      
      const params = StellarXdr.ScVal.scvMap([
        new StellarXdr.ScMapEntry({
          key: StellarXdr.ScVal.scvSymbol("amounts"),
          val: amounts,
        }),
      ]);
      
      const hex = "0x" + params.toXDR("hex");
      const result = secureParseScVal(hex);
      
      expect(result.success).toBe(true);
      
      const stringResult = secureScValToString(result.value!);
      expect(stringResult.success).toBe(true);
      expect(stringResult.value).toBe("{amounts: [100, 200, 300]}");
    });
  });

  describe("Edge Cases", () => {
    it("handles empty Vec", () => {
      const scVal = StellarXdr.ScVal.scvVec([]);
      const hex = "0x" + scVal.toXDR("hex");
      
      const result = secureParseScVal(hex);
      
      expect(result.success).toBe(true);
      expect(result.value?.vec()?.length).toBe(0);
    });

    it("handles empty Map", () => {
      const scVal = StellarXdr.ScVal.scvMap([]);
      const hex = "0x" + scVal.toXDR("hex");
      
      const result = secureParseScVal(hex);
      
      expect(result.success).toBe(true);
      expect(result.value?.map()?.length).toBe(0);
    });

    it("handles zero values", () => {
      const scVal = StellarXdr.ScVal.scvU32(0);
      const hex = "0x" + scVal.toXDR("hex");
      
      const result = secureParseScVal(hex);
      
      expect(result.success).toBe(true);
      expect(result.value?.u32()).toBe(0);
    });

    it("handles maximum U32 value", () => {
      const scVal = StellarXdr.ScVal.scvU32(0xffffffff);
      const hex = "0x" + scVal.toXDR("hex");
      
      const result = secureParseScVal(hex);
      
      expect(result.success).toBe(true);
      expect(result.value?.u32()).toBe(0xffffffff);
    });
  });
});
