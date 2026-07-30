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
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

type FakeRedisClient = {
  zremrangebyscore: (key: string, min: number, max: number) => Promise<number>;
  zcard: (key: string) => Promise<number>;
  zadd: (key: string, score: number, member: string) => Promise<number>;
  expire: (key: string, seconds: number) => Promise<number>;
  zrange: (
    key: string,
    start: number,
    stop: number,
    withScores?: string
  ) => Promise<string[]>;
};

function createFakeRedisClient(): FakeRedisClient {
  const store = new Map<string, Map<string, number>>();

  return {
    async zremrangebyscore(key, min, max) {
      const set = store.get(key);
      if (!set) return 0;
      let removed = 0;
      for (const [member, score] of set) {
        if (score >= min && score <= max) {
          set.delete(member);
          removed++;
        }
      }
      return removed;
    },
    async zcard(key) {
      return store.get(key)?.size ?? 0;
    },
    async zadd(key, score, member) {
      let set = store.get(key);
      if (!set) {
        set = new Map();
        store.set(key, set);
      }
      set.set(member, score);
      return 1;
    },
    async expire() {
      return 1;
    },
    async zrange(key, start, stop, withScores) {
      const set = store.get(key);
      if (!set) return [];
      const sorted = [...set.entries()].sort((a, b) => a[1] - b[1]);
      const slice = sorted.slice(start, stop === -1 ? undefined : stop + 1);
      if (withScores === "WITHSCORES") {
        return slice.flatMap(([member, score]) => [member, String(score)]);
      }
      return slice.map(([member]) => member);
    },
  };
}

describe("checkRateLimit", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  describe("in-memory fallback (no Redis configured)", () => {
    beforeEach(() => {
      vi.stubEnv("REDIS_URL", "");
    });

    it("allows requests up to the tier limit and blocks beyond it", async () => {
      const { checkRateLimit } = await import("../rateLimit");
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
    it("tracks separate buckets per hashed key", async () => {
      const { checkRateLimit } = await import("../rateLimit");

      const a = await checkRateLimit("key-a", "free");
      const b = await checkRateLimit("key-b", "free");

      expect(a.remaining).toBe(59);
      expect(b.remaining).toBe(59);
    });

    it("resets the sliding window after it elapses", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(0);

      const { checkRateLimit } = await import("../rateLimit");
      const hashedKey = "window-reset-key";

      for (let i = 0; i < 60; i++) {
        await checkRateLimit(hashedKey, "free");
      }
      expect((await checkRateLimit(hashedKey, "free")).allowed).toBe(false);

      vi.setSystemTime(61_000);

      const result = await checkRateLimit(hashedKey, "free");
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(59);
    });

    it("evicts all stale entries after window expires and reuses the same key", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(0);

      const { checkRateLimit } = await import("../rateLimit");
      const hashedKey = "eviction-key";

      for (let i = 0; i < 60; i++) {
        await checkRateLimit(hashedKey, "free");
      }

      vi.setSystemTime(61_000);

      const r1 = await checkRateLimit(hashedKey, "free");
      expect(r1.allowed).toBe(true);
      expect(r1.remaining).toBe(59);

      for (let i = 0; i < 58; i++) {
        await checkRateLimit(hashedKey, "free");
      }

      vi.setSystemTime(61_100);

      const r2 = await checkRateLimit(hashedKey, "free");
      expect(r2.allowed).toBe(true);
      expect(r2.remaining).toBe(59);
    });

    it("treats a key with all stale entries the same as a fresh key", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(0);

      const { checkRateLimit } = await import("../rateLimit");

      const freshKey = "fresh-key";
      const freshResult = await checkRateLimit(freshKey, "free");
      expect(freshResult.remaining).toBe(59);

      vi.setSystemTime(70_000);

      const staleKey = "stale-key";
      await checkRateLimit(staleKey, "free");

      vi.setSystemTime(140_000);

      const staleResult = await checkRateLimit(staleKey, "free");
      expect(staleResult.remaining).toBe(59);
    });
  });

  describe("Redis-backed sliding window", () => {
    let fakeClient: FakeRedisClient;

    beforeEach(() => {
      vi.stubEnv("REDIS_URL", "redis://localhost:6379");
      fakeClient = createFakeRedisClient();
      vi.doMock("../../cache/redisCache", () => ({
        isRedisEnabled: () => true,
        getRedisClient: () => fakeClient,
      }));
    });

    it("uses the oa:rl:{hashedKey} sorted-set key", async () => {
      const { checkRateLimit } = await import("../rateLimit");
      const zaddSpy = vi.spyOn(fakeClient, "zadd");

      await checkRateLimit("abc123", "free");

      expect(zaddSpy).toHaveBeenCalledWith(
        "oa:rl:abc123",
        expect.any(Number),
        expect.any(String)
      );
    });

    it("allows requests up to the tier limit and blocks beyond it", async () => {
      const { checkRateLimit } = await import("../rateLimit");
      const hashedKey = "redis-key-1";

      let lastResult;
      for (let i = 0; i < 60; i++) {
        lastResult = await checkRateLimit(hashedKey, "free");
        expect(lastResult.allowed).toBe(true);
      }
      expect(lastResult!.remaining).toBe(0);

      const blocked = await checkRateLimit(hashedKey, "free");
      expect(blocked.allowed).toBe(false);
      expect(blocked.retryAfter).toBeGreaterThan(0);
    });

    it("expires old entries outside the 60s window", async () => {
      const { checkRateLimit } = await import("../rateLimit");
      const hashedKey = "redis-expiry-key";

      const zremSpy = vi.spyOn(fakeClient, "zremrangebyscore");
      await checkRateLimit(hashedKey, "free");

      expect(zremSpy).toHaveBeenCalledWith(
        "oa:rl:redis-expiry-key",
        0,
        expect.any(Number)
      );
    });

    it("falls back to in-memory limiting when a Redis command fails", async () => {
      vi.spyOn(fakeClient, "zremrangebyscore").mockRejectedValueOnce(
        new Error("connection refused")
      );
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const { checkRateLimit } = await import("../rateLimit");
      const result = await checkRateLimit("fallback-key", "free");

      expect(result.allowed).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("in-memory rate limiting")
      );
    });
  });
});
