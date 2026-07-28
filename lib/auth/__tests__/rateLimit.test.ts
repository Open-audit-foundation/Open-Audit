import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  checkRateLimit,
  pruneExpiredBuckets,
  _getBucketsSize,
  _clearBuckets,
} from "../rateLimit";
import * as redisCache from "../../cache/redisCache";

describe("rateLimit", () => {
  beforeEach(() => {
    _clearBuckets();
    vi.useFakeTimers();
    vi.spyOn(redisCache, "isRedisEnabled").mockReturnValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("In-memory rate limiting", () => {
    it("allows requests under the tier limit and decrements remaining", async () => {
      const res1 = await checkRateLimit("key-1", "free");
      expect(res1.allowed).toBe(true);
      expect(res1.limit).toBe(60);
      expect(res1.remaining).toBe(59);

      const res2 = await checkRateLimit("key-1", "free");
      expect(res2.allowed).toBe(true);
      expect(res2.remaining).toBe(58);
    });

    it("enforces free tier limit (60 req/min)", async () => {
      for (let i = 0; i < 60; i++) {
        const res = await checkRateLimit("key-free", "free");
        expect(res.allowed).toBe(true);
      }

      const blocked = await checkRateLimit("key-free", "free");
      expect(blocked.allowed).toBe(false);
      expect(blocked.remaining).toBe(0);
      expect(blocked.retryAfter).toBeGreaterThan(0);
    });

    it("enforces partner tier limit (5000 req/min)", async () => {
      const res = await checkRateLimit("key-partner", "partner");
      expect(res.allowed).toBe(true);
      expect(res.limit).toBe(5000);
      expect(res.remaining).toBe(4999);
    });

    it("isolates rate limits between multiple callers", async () => {
      for (let i = 0; i < 60; i++) {
        await checkRateLimit("key-a", "free");
      }

      const blockedA = await checkRateLimit("key-a", "free");
      expect(blockedA.allowed).toBe(false);

      const resB = await checkRateLimit("key-b", "free");
      expect(resB.allowed).toBe(true);
      expect(resB.remaining).toBe(59);
    });

    it("evicts expired timestamps and allows new requests after 60 seconds", async () => {
      for (let i = 0; i < 60; i++) {
        await checkRateLimit("key-expire", "free");
      }

      expect((await checkRateLimit("key-expire", "free")).allowed).toBe(false);

      // Advance time by 61 seconds
      vi.advanceTimersByTime(61_000);

      const resAfter = await checkRateLimit("key-expire", "free");
      expect(resAfter.allowed).toBe(true);
      expect(resAfter.remaining).toBe(59);
    });

    it("evicts empty buckets from the Map when timestamps expire (fixes memory leak)", async () => {
      expect(_getBucketsSize()).toBe(0);

      await checkRateLimit("caller-1", "free");
      await checkRateLimit("caller-2", "free");
      expect(_getBucketsSize()).toBe(2);

      // Advance time by 61 seconds (all requests expire)
      vi.advanceTimersByTime(61_000);

      // Explicit prune
      pruneExpiredBuckets();

      // Buckets should be completely evicted from the Map
      expect(_getBucketsSize()).toBe(0);
    });

    it("automatically evicts empty bucket on subsequent checkRateLimit call", async () => {
      await checkRateLimit("caller-inactive", "free");
      expect(_getBucketsSize()).toBe(1);

      vi.advanceTimersByTime(61_000);

      // Caller inactive gets pruned when another caller checks or caller inactive checks
      await checkRateLimit("caller-new", "free");
      pruneExpiredBuckets();

      // caller-inactive is evicted, only caller-new remains
      expect(_getBucketsSize()).toBe(1);
    });
  });

  describe("Redis fallback behavior", () => {
    it("falls back to in-memory rate limiting when Redis throws an error", async () => {
      vi.spyOn(redisCache, "isRedisEnabled").mockReturnValue(true);
      vi.spyOn(redisCache, "getRedisClient").mockImplementation(() => {
        throw new Error("Redis connection refused");
      });

      const res = await checkRateLimit("key-redis-fail", "free");
      expect(res.allowed).toBe(true);
      expect(res.remaining).toBe(59);
      expect(_getBucketsSize()).toBe(1);
    });
  });
});
