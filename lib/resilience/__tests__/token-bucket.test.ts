/**
 * Token Bucket Rate Limiter Tests
 *
 * Verifies:
 * - Token consumption and refill mechanics
 * - Queuing and backpressure
 * - Queue size limits
 * - Proper cleanup (no leaked timers)
 */

import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from "vitest";
import { createTokenBucket, type TokenBucket } from "../token-bucket";

describe("TokenBucket", () => {
  let bucket: TokenBucket;

  afterEach(() => {
    if (bucket) {
      bucket.dispose();
    }
  });

  describe("Initialization", () => {
    it("should start with full capacity", () => {
      bucket = createTokenBucket({ capacity: 10, refillRate: 5 });
      const metrics = bucket.metrics();
      expect(metrics.availableTokens).toBe(10);
    });

    it("should throw on invalid capacity", () => {
      expect(() =>
        createTokenBucket({ capacity: 0, refillRate: 5 })
      ).toThrow("capacity must be positive");
    });

    it("should throw on invalid refillRate", () => {
      expect(() =>
        createTokenBucket({ capacity: 10, refillRate: 0 })
      ).toThrow("refillRate must be positive");
    });
  });

  describe("Token acquisition (immediate)", () => {
    beforeEach(() => {
      bucket = createTokenBucket({ capacity: 10, refillRate: 5 });
    });

    it("should acquire tokens immediately when available", async () => {
      await bucket.acquire();
      const metrics = bucket.metrics();
      expect(metrics.availableTokens).toBe(9);
      expect(metrics.totalConsumed).toBe(1);
    });

    it("should handle multiple immediate acquisitions", async () => {
      await bucket.acquire();
      await bucket.acquire();
      await bucket.acquire();

      const metrics = bucket.metrics();
      expect(metrics.availableTokens).toBe(7);
      expect(metrics.totalConsumed).toBe(3);
    });

    it("should allow burst up to capacity", async () => {
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(bucket.acquire());
      }

      await Promise.all(promises);

      const metrics = bucket.metrics();
      expect(metrics.availableTokens).toBe(0);
      expect(metrics.totalConsumed).toBe(10);
    });

    it("should support tryAcquire for non-blocking checks", () => {
      expect(bucket.tryAcquire()).toBe(true);
      expect(bucket.tryAcquire()).toBe(true);

      const metrics = bucket.metrics();
      expect(metrics.totalConsumed).toBe(2);
    });

    it("should return false from tryAcquire when empty", async () => {
      // Drain the bucket
      for (let i = 0; i < 10; i++) {
        await bucket.acquire();
      }

      expect(bucket.tryAcquire()).toBe(false);
    });
  });

  describe("Token refill mechanism", () => {
    beforeEach(() => {
      bucket = createTokenBucket({ capacity: 10, refillRate: 10 }); // 10 tokens/sec
    });

    it("should refill tokens over time", async () => {
      // Consume 5 tokens
      for (let i = 0; i < 5; i++) {
        await bucket.acquire();
      }

      expect(bucket.metrics().availableTokens).toBe(5);

      // Wait 500ms (should add ~5 tokens at rate of 10/sec)
      await new Promise((resolve) => setTimeout(resolve, 500));

      const metrics = bucket.metrics();
      // Should be close to 10 (capped by capacity)
      expect(metrics.availableTokens).toBeGreaterThanOrEqual(9);
      expect(metrics.availableTokens).toBeLessThanOrEqual(10);
    });

    it("should not exceed capacity during refill", async () => {
      // Start with full bucket
      expect(bucket.metrics().availableTokens).toBe(10);

      // Wait for refill period
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Should still be at capacity
      expect(bucket.metrics().availableTokens).toBe(10);
    });
  });

  describe("Queuing and backpressure", () => {
    beforeEach(() => {
      bucket = createTokenBucket({
        capacity: 2,
        refillRate: 10, // 10 tokens/sec for predictable refill
        maxQueueSize: 5,
      });
    });

    it("should queue requests when bucket is empty", async () => {
      // Drain bucket
      await bucket.acquire();
      await bucket.acquire();

      // Next request should queue (not resolve immediately)
      const promise = bucket.acquire();
      
      // Should be queued
      expect(bucket.metrics().queuedRequests).toBe(1);

      // Wait for refill
      await promise;

      // Should have been processed
      expect(bucket.metrics().totalQueued).toBe(1);
    });

    it("should process queued requests FIFO", async () => {
      const results: number[] = [];

      // Drain bucket
      await bucket.acquire();
      await bucket.acquire();

      // Queue 3 requests
      const p1 = bucket.acquire().then(() => results.push(1));
      const p2 = bucket.acquire().then(() => results.push(2));
      const p3 = bucket.acquire().then(() => results.push(3));

      await Promise.all([p1, p2, p3]);

      // Should be processed in order
      expect(results).toEqual([1, 2, 3]);
    });

    it("should reject when queue is full", async () => {
      // Drain bucket
      await bucket.acquire();
      await bucket.acquire();

      // Fill the queue (max 5)
      const queuedPromises = [];
      for (let i = 0; i < 5; i++) {
        queuedPromises.push(bucket.acquire());
      }

      // Next request should reject immediately
      await expect(bucket.acquire()).rejects.toThrow("queue full");

      const metrics = bucket.metrics();
      expect(metrics.totalRejected).toBe(1);

      // Wait for queue to process
      await Promise.all(queuedPromises);
    });

    it("should track queuing metrics", async () => {
      // Drain bucket
      await bucket.acquire();
      await bucket.acquire();

      // Queue some requests
      const p1 = bucket.acquire();
      const p2 = bucket.acquire();

      expect(bucket.metrics().queuedRequests).toBe(2);

      await Promise.all([p1, p2]);

      expect(bucket.metrics().queuedRequests).toBe(0);
      expect(bucket.metrics().totalQueued).toBe(2);
    });
  });

  describe("Metrics", () => {
    beforeEach(() => {
      bucket = createTokenBucket({ capacity: 10, refillRate: 5 });
    });

    it("should track total consumed", async () => {
      await bucket.acquire();
      await bucket.acquire();
      await bucket.acquire();

      expect(bucket.metrics().totalConsumed).toBe(3);
    });

    it("should track available tokens", async () => {
      await bucket.acquire();
      expect(bucket.metrics().availableTokens).toBe(9);
    });

    it("should track rejected requests", async () => {
      const smallBucket = createTokenBucket({
        capacity: 1,
        refillRate: 1,
        maxQueueSize: 1,
      });

      // Drain bucket
      await smallBucket.acquire();

      // Fill queue
      const p1 = smallBucket.acquire();

      // This should reject
      await expect(smallBucket.acquire()).rejects.toThrow();

      expect(smallBucket.metrics().totalRejected).toBe(1);

      await p1;
      smallBucket.dispose();
    });
  });

  describe("Resource cleanup", () => {
    it("should clean up refill timer on dispose", async () => {
      bucket = createTokenBucket({ capacity: 10, refillRate: 10 });

      // Drain some tokens
      await bucket.acquire();
      await bucket.acquire();

      const tokensBefore = bucket.metrics().availableTokens;

      // Dispose (stops refill)
      bucket.dispose();

      // Wait what would normally be a refill period
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Tokens should not have increased (timer was cleared)
      expect(bucket.metrics().availableTokens).toBe(tokensBefore);
    });

    it("should reject queued requests on dispose", async () => {
      bucket = createTokenBucket({ capacity: 1, refillRate: 1 });

      // Drain bucket
      await bucket.acquire();

      // Queue a request
      const promise = bucket.acquire();

      // Dispose immediately
      bucket.dispose();

      // Queued request should reject
      await expect(promise).rejects.toThrow("disposed");
    });

    it("should reject new requests after dispose", async () => {
      bucket = createTokenBucket({ capacity: 10, refillRate: 5 });
      bucket.dispose();

      await expect(bucket.acquire()).rejects.toThrow("disposed");
    });

    it("should return false from tryAcquire after dispose", () => {
      bucket = createTokenBucket({ capacity: 10, refillRate: 5 });
      bucket.dispose();

      expect(bucket.tryAcquire()).toBe(false);
    });
  });

  describe("Edge cases", () => {
    it("should handle fractional refill rates", async () => {
      bucket = createTokenBucket({ capacity: 10, refillRate: 0.5 }); // 0.5 tokens/sec

      // Drain bucket
      for (let i = 0; i < 10; i++) {
        await bucket.acquire();
      }

      // Wait 2 seconds (should add 1 token)
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Should have refilled approximately 1 token
      const metrics = bucket.metrics();
      expect(metrics.availableTokens).toBeGreaterThanOrEqual(0);
      expect(metrics.availableTokens).toBeLessThanOrEqual(2);
    });

    it("should handle high refill rates", async () => {
      bucket = createTokenBucket({ capacity: 100, refillRate: 100 }); // 100 tokens/sec

      // Drain bucket
      for (let i = 0; i < 100; i++) {
        await bucket.acquire();
      }

      expect(bucket.metrics().availableTokens).toBe(0);

      // Wait 100ms (should add ~10 tokens)
      await new Promise((resolve) => setTimeout(resolve, 100));

      const metrics = bucket.metrics();
      expect(metrics.availableTokens).toBeGreaterThanOrEqual(8);
      expect(metrics.availableTokens).toBeLessThanOrEqual(12);
    });

    it("should handle concurrent acquire calls", async () => {
      bucket = createTokenBucket({ capacity: 50, refillRate: 10 });

      const promises = [];
      for (let i = 0; i < 100; i++) {
        promises.push(bucket.acquire());
      }

      await Promise.all(promises);

      const metrics = bucket.metrics();
      expect(metrics.totalConsumed).toBe(100);
    });
  });
});

describe("Structured log events", () => {
  let consoleSpy: MockInstance;
  let logBucket: ReturnType<typeof createTokenBucket>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    if (logBucket) logBucket.dispose();
  });

  /**
   * Acceptance criterion: token bucket exhaustion is distinguishable from
   * genuine upstream errors in logs (token_bucket_throttled vs upstream errors).
   */
  it("emits token_bucket_throttled when a request is queued (no tokens available)", async () => {
    logBucket = createTokenBucket({ capacity: 1, refillRate: 1, maxQueueSize: 5 });

    // Drain the one token
    await logBucket.acquire();

    // Next acquire should queue and log throttled
    const pending = logBucket.acquire();

    const jsonCalls = consoleSpy.mock.calls
      .map((args) => {
        try { return JSON.parse(args[0]); } catch { return null; }
      })
      .filter(Boolean);

    const throttleEvent = jsonCalls.find((e) => e.event === "token_bucket_throttled");
    expect(throttleEvent).toBeDefined();
    expect(throttleEvent.reason).toMatch(/queued/);
    expect(throttleEvent.availableTokens).toBe(0);
    expect(throttleEvent.timestamp).toBeDefined();

    // No circuit_breaker or upstream-error event should be present
    const cbEvent = jsonCalls.find((e) => e.event === "circuit_breaker_state_change");
    expect(cbEvent).toBeUndefined();

    // Clean up pending promise
    await pending;
  });

  it("emits token_bucket_rejected when queue is full", async () => {
    logBucket = createTokenBucket({ capacity: 1, refillRate: 1, maxQueueSize: 2 });

    // Drain the bucket
    await logBucket.acquire();

    // Fill the queue
    const p1 = logBucket.acquire();
    const p2 = logBucket.acquire();

    consoleSpy.mockClear();

    // This one should be rejected
    await expect(logBucket.acquire()).rejects.toThrow("queue full");

    const jsonCalls = consoleSpy.mock.calls
      .map((args) => {
        try { return JSON.parse(args[0]); } catch { return null; }
      })
      .filter(Boolean);

    const rejectEvent = jsonCalls.find((e) => e.event === "token_bucket_rejected");
    expect(rejectEvent).toBeDefined();
    expect(rejectEvent.reason).toMatch(/queue full/);
    expect(rejectEvent.queueSize).toBe(2);
    expect(rejectEvent.timestamp).toBeDefined();

    await Promise.all([p1, p2]);
  });

  it("does NOT emit throttled/rejected log when token is immediately available", async () => {
    logBucket = createTokenBucket({ capacity: 10, refillRate: 5 });

    await logBucket.acquire();

    const jsonCalls = consoleSpy.mock.calls
      .map((args) => {
        try { return JSON.parse(args[0]); } catch { return null; }
      })
      .filter(Boolean);

    const throttleEvent = jsonCalls.find(
      (e) => e.event === "token_bucket_throttled" || e.event === "token_bucket_rejected"
    );
    expect(throttleEvent).toBeUndefined();
  });
});
