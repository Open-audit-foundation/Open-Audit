/**
 * Unit tests for XDR Parser Security Hardening
 *
 * These tests verify that the security guards correctly prevent:
 * - Stack overflow attacks (deep recursion)
 * - Out-of-memory attacks (large payloads)
 * - Denial of service attacks (infinite loops)
 * - Malformed XDR exploitation
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  createParsingContext,
  enterLevel,
  checkTimeout,
  trackAllocation,
  validateCollectionSize,
  validateHexLength,
  safeParseXdr,
  MaxDepthExceededError,
  MaxPayloadSizeExceededError,
  MaxParseTimeExceededError,
  MaxCollectionSizeExceededError,
  MaxHexLengthExceededError,
  MalformedXdrError,
  getSecurityMetrics,
  resetSecurityMetrics,
  detectAttackPattern,
  toSafeErrorMessage,
  MAX_RECURSION_DEPTH,
  MAX_PAYLOAD_SIZE_BYTES,
  MAX_PARSE_TIME_MS,
  MAX_COLLECTION_SIZE,
  MAX_HEX_STRING_LENGTH,
} from "../parser-security";

describe("Parser Security", () => {
  beforeEach(() => {
    // Reset metrics before each test
    resetSecurityMetrics();
  });

  describe("Parsing Context", () => {
    it("creates a parsing context with default limits", () => {
      const ctx = createParsingContext();
      
      expect(ctx.currentDepth).toBe(0);
      expect(ctx.maxDepth).toBe(MAX_RECURSION_DEPTH);
      expect(ctx.allocatedBytes).toBe(0);
      expect(ctx.maxAllocation).toBe(MAX_PAYLOAD_SIZE_BYTES);
      expect(ctx.maxParseTime).toBe(MAX_PARSE_TIME_MS);
      expect(ctx.startTime).toBeGreaterThan(0);
    });
  });

  describe("Recursion Depth Tracking", () => {
    it("allows entering levels within limit", () => {
      let ctx = createParsingContext();
      
      for (let i = 0; i < 50; i++) {
        ctx = enterLevel(ctx);
        expect(ctx.currentDepth).toBe(i + 1);
      }
    });

    it("throws MaxDepthExceededError when limit is exceeded", () => {
      let ctx = createParsingContext();
      
      // Enter levels up to the limit
      for (let i = 0; i < MAX_RECURSION_DEPTH; i++) {
        ctx = enterLevel(ctx);
      }
      
      // Next level should throw
      expect(() => enterLevel(ctx)).toThrow(MaxDepthExceededError);
    });

    it("provides descriptive error message", () => {
      let ctx = createParsingContext();
      
      for (let i = 0; i < MAX_RECURSION_DEPTH; i++) {
        ctx = enterLevel(ctx);
      }
      
      try {
        enterLevel(ctx);
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(MaxDepthExceededError);
        expect((error as MaxDepthExceededError).message).toContain("Maximum recursion depth exceeded");
        expect((error as MaxDepthExceededError).message).toContain(String(MAX_RECURSION_DEPTH));
      }
    });
  });

  describe("Memory Allocation Tracking", () => {
    it("tracks memory allocation within limit", () => {
      let ctx = createParsingContext();
      
      ctx = trackAllocation(ctx, 1000);
      expect(ctx.allocatedBytes).toBe(1000);
      
      ctx = trackAllocation(ctx, 2000);
      expect(ctx.allocatedBytes).toBe(3000);
    });

    it("throws MaxPayloadSizeExceededError when limit is exceeded", () => {
      let ctx = createParsingContext();
      
      // Try to allocate more than allowed
      expect(() => trackAllocation(ctx, MAX_PAYLOAD_SIZE_BYTES + 1))
        .toThrow(MaxPayloadSizeExceededError);
    });

    it("provides descriptive error message", () => {
      const ctx = createParsingContext();
      const oversizedAllocation = MAX_PAYLOAD_SIZE_BYTES + 1000;
      
      try {
        trackAllocation(ctx, oversizedAllocation);
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(MaxPayloadSizeExceededError);
        expect((error as MaxPayloadSizeExceededError).message).toContain("Payload size exceeded");
        expect((error as MaxPayloadSizeExceededError).message).toContain(String(MAX_PAYLOAD_SIZE_BYTES));
      }
    });
  });

  describe("Parse Timeout Detection", () => {
    it("allows parsing within time limit", () => {
      const ctx = createParsingContext();
      
      // Should not throw immediately
      expect(() => checkTimeout(ctx)).not.toThrow();
    });

    it("throws MaxParseTimeExceededError when timeout is reached", () => {
      const ctx = {
        ...createParsingContext(),
        startTime: Date.now() - (MAX_PARSE_TIME_MS + 1000), // Started too long ago
      };
      
      expect(() => checkTimeout(ctx)).toThrow(MaxParseTimeExceededError);
    });

    it("provides descriptive error message", () => {
      const ctx = {
        ...createParsingContext(),
        startTime: Date.now() - (MAX_PARSE_TIME_MS + 1000),
      };
      
      try {
        checkTimeout(ctx);
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(MaxParseTimeExceededError);
        expect((error as MaxParseTimeExceededError).message).toContain("Parsing time exceeded");
        expect((error as MaxParseTimeExceededError).message).toContain(String(MAX_PARSE_TIME_MS));
      }
    });
  });

  describe("Collection Size Validation", () => {
    it("allows collections within limit", () => {
      expect(() => validateCollectionSize(100)).not.toThrow();
      expect(() => validateCollectionSize(MAX_COLLECTION_SIZE)).not.toThrow();
    });

    it("throws MaxCollectionSizeExceededError when limit is exceeded", () => {
      expect(() => validateCollectionSize(MAX_COLLECTION_SIZE + 1))
        .toThrow(MaxCollectionSizeExceededError);
    });

    it("provides descriptive error message", () => {
      try {
        validateCollectionSize(MAX_COLLECTION_SIZE + 100);
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(MaxCollectionSizeExceededError);
        expect((error as MaxCollectionSizeExceededError).message).toContain("Collection size exceeded");
        expect((error as MaxCollectionSizeExceededError).message).toContain(String(MAX_COLLECTION_SIZE));
      }
    });
  });

  describe("Hex Length Validation", () => {
    it("allows hex strings within limit", () => {
      const validHex = "0x" + "a".repeat(1000);
      expect(() => validateHexLength(validHex)).not.toThrow();
    });

    it("throws MaxHexLengthExceededError when limit is exceeded", () => {
      const tooLongHex = "0x" + "a".repeat(MAX_HEX_STRING_LENGTH + 10);
      expect(() => validateHexLength(tooLongHex))
        .toThrow(MaxHexLengthExceededError);
    });

    it("handles hex strings without 0x prefix", () => {
      const tooLongHex = "a".repeat(MAX_HEX_STRING_LENGTH + 10);
      expect(() => validateHexLength(tooLongHex))
        .toThrow(MaxHexLengthExceededError);
    });
  });

  describe("Safe Parse Wrapper", () => {
    it("returns success result for valid parsing", () => {
      const result = safeParseXdr(() => {
        return "parsed value";
      });
      
      expect(result.success).toBe(true);
      expect(result.value).toBe("parsed value");
      expect(result.error).toBeNull();
    });

    it("catches and wraps MaxDepthExceededError", () => {
      const result = safeParseXdr((ctx) => {
        let currentCtx = ctx;
        for (let i = 0; i < MAX_RECURSION_DEPTH + 1; i++) {
          currentCtx = enterLevel(currentCtx);
        }
        return "should not reach";
      });
      
      expect(result.success).toBe(false);
      expect(result.value).toBeNull();
      expect(result.error).toBeInstanceOf(MaxDepthExceededError);
    });

    it("catches and wraps MaxPayloadSizeExceededError", () => {
      const result = safeParseXdr((ctx) => {
        trackAllocation(ctx, MAX_PAYLOAD_SIZE_BYTES + 1);
        return "should not reach";
      });
      
      expect(result.success).toBe(false);
      expect(result.value).toBeNull();
      expect(result.error).toBeInstanceOf(MaxPayloadSizeExceededError);
    });

    it("wraps unknown errors as MalformedXdrError", () => {
      const result = safeParseXdr(() => {
        throw new Error("Some unknown error");
      });
      
      expect(result.success).toBe(false);
      expect(result.value).toBeNull();
      expect(result.error).toBeInstanceOf(MalformedXdrError);
      expect(result.error?.message).toContain("Some unknown error");
    });
  });

  describe("Security Metrics", () => {
    it("records successful parses", () => {
      resetSecurityMetrics();
      
      safeParseXdr(() => "success");
      
      const metrics = getSecurityMetrics();
      expect(metrics.totalParses).toBe(1);
      expect(metrics.successfulParses).toBe(1);
      expect(metrics.rejectedParses).toBe(0);
    });

    it("records rejected parses", () => {
      resetSecurityMetrics();
      
      safeParseXdr((ctx) => {
        throw new MaxDepthExceededError(101, 100);
      });
      
      const metrics = getSecurityMetrics();
      expect(metrics.totalParses).toBe(1);
      expect(metrics.successfulParses).toBe(0);
      expect(metrics.rejectedParses).toBe(1);
      expect(metrics.errorsByType["MAX_DEPTH_EXCEEDED"]).toBe(1);
    });

    it("tracks maximum depth reached", () => {
      resetSecurityMetrics();
      
      safeParseXdr((ctx) => {
        let currentCtx = ctx;
        for (let i = 0; i < 50; i++) {
          currentCtx = enterLevel(currentCtx);
        }
        return "success";
      });
      
      const metrics = getSecurityMetrics();
      expect(metrics.maxDepthReached).toBeGreaterThanOrEqual(50);
    });

    it("tracks maximum payload size seen", () => {
      resetSecurityMetrics();
      
      safeParseXdr((ctx) => {
        trackAllocation(ctx, 5000);
        return "success";
      });
      
      const metrics = getSecurityMetrics();
      expect(metrics.maxPayloadSizeSeen).toBeGreaterThanOrEqual(5000);
    });
  });

  describe("Attack Pattern Detection", () => {
    it("does not trigger on low rejection rate", () => {
      resetSecurityMetrics();
      
      // 95 successful, 5 rejected
      for (let i = 0; i < 95; i++) {
        safeParseXdr(() => "success");
      }
      for (let i = 0; i < 5; i++) {
        safeParseXdr(() => {
          throw new MaxDepthExceededError(101, 100);
        });
      }
      
      expect(detectAttackPattern()).toBe(false);
    });

    it("triggers on high rejection rate", () => {
      resetSecurityMetrics();
      
      // 80 successful, 20 rejected (20% rejection rate)
      for (let i = 0; i < 80; i++) {
        safeParseXdr(() => "success");
      }
      for (let i = 0; i < 20; i++) {
        safeParseXdr(() => {
          throw new MaxDepthExceededError(101, 100);
        });
      }
      
      expect(detectAttackPattern()).toBe(true);
    });

    it("triggers on repeated depth errors", () => {
      resetSecurityMetrics();
      
      // 90 successful, 15 depth errors
      for (let i = 0; i < 90; i++) {
        safeParseXdr(() => "success");
      }
      for (let i = 0; i < 15; i++) {
        safeParseXdr(() => {
          throw new MaxDepthExceededError(101, 100);
        });
      }
      
      expect(detectAttackPattern()).toBe(true);
    });
  });

  describe("Safe Error Messages", () => {
    it("converts MaxDepthExceededError to safe message", () => {
      const error = new MaxDepthExceededError(101, 100);
      const message = toSafeErrorMessage(error);
      
      expect(message).toContain("deeply nested");
      expect(message).not.toContain("101"); // No technical details
    });

    it("converts MaxPayloadSizeExceededError to safe message", () => {
      const error = new MaxPayloadSizeExceededError(1000, 500);
      const message = toSafeErrorMessage(error);
      
      expect(message).toContain("too large");
      expect(message).not.toContain("1000"); // No technical details
    });

    it("converts MaxParseTimeExceededError to safe message", () => {
      const error = new MaxParseTimeExceededError(6000, 5000);
      const message = toSafeErrorMessage(error);
      
      expect(message).toContain("too long");
      expect(message).not.toContain("6000"); // No technical details
    });

    it("converts MalformedXdrError to safe message", () => {
      const error = new MalformedXdrError("Invalid XDR structure");
      const message = toSafeErrorMessage(error);
      
      expect(message).toContain("malformed");
      expect(message).not.toContain("Invalid XDR structure"); // No technical details
    });
  });

  describe("Configuration Constants", () => {
    it("has reasonable recursion depth limit", () => {
      expect(MAX_RECURSION_DEPTH).toBe(100);
      expect(MAX_RECURSION_DEPTH).toBeGreaterThan(10); // Allow legitimate nesting
      expect(MAX_RECURSION_DEPTH).toBeLessThan(1000); // Block attacks
    });

    it("has reasonable payload size limit", () => {
      expect(MAX_PAYLOAD_SIZE_BYTES).toBe(10 * 1024 * 1024); // 10 MB
      expect(MAX_PAYLOAD_SIZE_BYTES).toBeGreaterThan(1024 * 1024); // Allow large payloads
      expect(MAX_PAYLOAD_SIZE_BYTES).toBeLessThan(100 * 1024 * 1024); // Block excessive
    });

    it("has reasonable parse time limit", () => {
      expect(MAX_PARSE_TIME_MS).toBe(5000); // 5 seconds
      expect(MAX_PARSE_TIME_MS).toBeGreaterThan(1000); // Allow complex parsing
      expect(MAX_PARSE_TIME_MS).toBeLessThan(60000); // Block infinite loops
    });

    it("has reasonable collection size limit", () => {
      expect(MAX_COLLECTION_SIZE).toBe(10000);
      expect(MAX_COLLECTION_SIZE).toBeGreaterThan(1000); // Allow large collections
      expect(MAX_COLLECTION_SIZE).toBeLessThan(1000000); // Block excessive
    });
  });
});
