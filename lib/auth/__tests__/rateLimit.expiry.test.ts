import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as redisCache from "../../cache/redisCache";
import {
  _clearBuckets,
  _getBucketsSize,
  checkRateLimit,
  pruneExpiredBuckets,
} from "../rateLimit";

describe("fallback expiry compaction", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    vi.spyOn(redisCache, "isRedisEnabled").mockReturnValue(false);
    _clearBuckets();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    _clearBuckets();
  });

  it.each(["request", "global"])(
    "preserves a large live suffix after %s expiry at the exact boundary",
    async (path) => {
      for (let i = 0; i < 2500; i++) {
        await checkRateLimit("partial", "partner");
      }
      vi.setSystemTime(101_000);
      for (let i = 0; i < 2500; i++) {
        await checkRateLimit("partial", "partner");
      }
      vi.setSystemTime(159_999);
      expect((await checkRateLimit("partial", "partner")).allowed).toBe(false);
      vi.setSystemTime(160_000);
      if (path === "global") pruneExpiredBuckets();
      expect(await checkRateLimit("partial", "partner")).toEqual({
        allowed: true,
        limit: 5000,
        remaining: 2499,
        retryAfter: undefined,
      });
      expect((await checkRateLimit("partial", "free")).allowed).toBe(false);
      vi.setSystemTime(161_000);
      expect((await checkRateLimit("partial", "partner")).remaining).toBe(4998);
      vi.setSystemTime(221_000);
      if (path === "global") {
        pruneExpiredBuckets();
        expect(_getBucketsSize()).toBe(0);
      }
      expect((await checkRateLimit("partial", "partner")).remaining).toBe(4999);
    }
  );

  it("cleans expired fallback keys after Redis recovers", async () => {
    await checkRateLimit("outage-only", "free");
    expect(_getBucketsSize()).toBe(1);

    vi.setSystemTime(160_001);
    vi.mocked(redisCache.isRedisEnabled).mockReturnValue(true);
    vi.spyOn(redisCache, "getRedisClient").mockReturnValue({
      eval: vi.fn().mockResolvedValue([1, 1, 0]),
    } as never);

    expect((await checkRateLimit("redis-recovered", "free")).allowed).toBe(true);
    expect(_getBucketsSize()).toBe(0);
  });

  it("keeps live timestamps when an explicit prune time is NaN or negative infinity", async () => {
    await checkRateLimit("invalid-time", "free");
    pruneExpiredBuckets(Number.NaN);
    pruneExpiredBuckets(-Infinity);
    expect((await checkRateLimit("invalid-time", "free")).remaining).toBe(58);
  });
});
