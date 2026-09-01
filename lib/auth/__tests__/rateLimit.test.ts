import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as redisCache from "../../cache/redisCache";
import {
  checkRateLimit,
  pruneExpiredBuckets,
  _getBucketsSize,
  _clearBuckets,
} from "../rateLimit";

describe("checkRateLimit", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    _clearBuckets();
  });

  describe("in-memory fallback (no Redis configured)", () => {
    beforeEach(() => {
      vi.stubEnv("REDIS_URL", "");
      vi.spyOn(redisCache, "isRedisEnabled").mockReturnValue(false);
    });

    it("allows requests up to the tier limit and blocks beyond it", async () => {
      const hashedKey = "in-memory-key-1";

      let lastResult;
      for (let i = 0; i < 60; i++) {
        lastResult = await checkRateLimit(hashedKey, "free");
        expect(lastResult.allowed).toBe(true);
      }
      expect(lastResult!.remaining).toBe(0);

      const blocked = await checkRateLimit(hashedKey, "free");
      expect(blocked.allowed).toBe(false);
      expect(blocked.limit).toBe(60);
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
      vi.useFakeTimers();

      for (let i = 0; i < 60; i++) {
        await checkRateLimit("key-expire", "free");
      }

      expect((await checkRateLimit("key-expire", "free")).allowed).toBe(false);

      vi.advanceTimersByTime(61_000);

      const resAfter = await checkRateLimit("key-expire", "free");
      expect(resAfter.allowed).toBe(true);
      expect(resAfter.remaining).toBe(59);
    });

    it("evicts empty buckets from the Map when timestamps expire", async () => {
      vi.useFakeTimers();
      expect(_getBucketsSize()).toBe(0);

      await checkRateLimit("caller-1", "free");
      await checkRateLimit("caller-2", "free");
      expect(_getBucketsSize()).toBe(2);

      vi.advanceTimersByTime(61_000);
      pruneExpiredBuckets();

      expect(_getBucketsSize()).toBe(0);
    });
  });

  describe("Redis fallback behavior", () => {
    beforeEach(() => {
      vi.spyOn(redisCache, "isRedisEnabled").mockReturnValue(true);
    });

    it("falls back to in-memory rate limiting when Redis throws an error", async () => {
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
