import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import Redis from "ioredis";
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

    it("uses fallback admission time when Redis failures finish out of order", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(100_000);
      vi.spyOn(console, "warn").mockImplementation(() => {});

      let rejectOldest!: (reason: Error) => void;
      const delayed = new Promise<never>((_resolve, reject) => {
        rejectOldest = reject;
      });
      const client = {
        eval: vi.fn()
          .mockRejectedValue(new Error("Redis unavailable"))
          .mockReturnValueOnce(delayed),
      };
      vi.spyOn(redisCache, "getRedisClient").mockReturnValue(client as never);

      const oldestRequest = checkRateLimit("out-of-order-fallback", "free");
      vi.setSystemTime(101_000);
      for (let i = 0; i < 59; i++) {
        expect((await checkRateLimit("out-of-order-fallback", "free")).allowed).toBe(true);
      }
      rejectOldest(new Error("The oldest Redis request failed last"));
      expect((await oldestRequest).allowed).toBe(true);

      // All sixty fallback admissions happened at 101_000, not Redis start time.
      vi.setSystemTime(160_000);
      expect(await checkRateLimit("out-of-order-fallback", "free")).toEqual({
        allowed: false,
        limit: 60,
        remaining: 0,
        retryAfter: 1,
      });
      vi.setSystemTime(161_000);
      expect(await checkRateLimit("out-of-order-fallback", "free")).toEqual({
        allowed: true,
        limit: 60,
        remaining: 59,
        retryAfter: undefined,
      });
    });

    it("retains timestamp ordering if the fallback clock moves backward", async () => {
      vi.useFakeTimers();
      vi.spyOn(redisCache, "isRedisEnabled").mockReturnValue(false);
      vi.setSystemTime(101_000);
      for (let i = 0; i < 59; i++) {
        await checkRateLimit("clock-reversal", "free");
      }
      vi.setSystemTime(100_000);
      expect((await checkRateLimit("clock-reversal", "free")).allowed).toBe(true);

      vi.setSystemTime(160_000);
      expect((await checkRateLimit("clock-reversal", "free")).allowed).toBe(true);
      expect(await checkRateLimit("clock-reversal", "free")).toEqual({
        allowed: false,
        limit: 60,
        remaining: 0,
        retryAfter: 1,
      });
    });

    it("rechecks expiry and retry delay after a delayed Redis rejection", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(100_000);
      vi.spyOn(console, "warn").mockImplementation(() => {});

      let rejectOldest!: (reason: Error) => void;
      const delayed = new Promise<never>((_resolve, reject) => {
        rejectOldest = reject;
      });
      const client = {
        eval: vi.fn()
          .mockRejectedValue(new Error("Redis unavailable"))
          .mockReturnValueOnce(delayed),
      };
      vi.spyOn(redisCache, "getRedisClient").mockReturnValue(client as never);
      const oldestRequest = checkRateLimit("delayed-decision", "free");

      vi.setSystemTime(160_000);
      for (let i = 0; i < 60; i++) {
        expect((await checkRateLimit("delayed-decision", "free")).allowed).toBe(true);
      }
      rejectOldest(new Error("Redis rejected after one minute"));
      expect(await oldestRequest).toEqual({
        allowed: false,
        limit: 60,
        remaining: 0,
        retryAfter: 60,
      });

      let rejectRecovery!: (reason: Error) => void;
      client.eval.mockReturnValueOnce(new Promise<never>((_resolve, reject) => {
        rejectRecovery = reject;
      }));
      const recovery = checkRateLimit("delayed-decision", "free");
      vi.setSystemTime(220_000);
      rejectRecovery(new Error("Redis rejected after the stored window expired"));
      expect(await recovery).toEqual({
        allowed: true,
        limit: 60,
        remaining: 59,
        retryAfter: undefined,
      });
    });

  });
});

describe("Redis primary path", () => {
  beforeEach(() => {
    vi.spyOn(redisCache, "isRedisEnabled").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    _clearBuckets();
  });

  function mockRedisResult(result: unknown) {
    return { eval: vi.fn().mockResolvedValue(result) };
  }

  it("uses Redis when enabled and allows under the free-tier limit", async () => {
    const client = mockRedisResult([1, 1, 0]);
    vi.spyOn(redisCache, "getRedisClient").mockReturnValue(
      client as never
    );

    const res = await checkRateLimit("redis-ok-key", "free");
    expect(res.allowed).toBe(true);
    expect(res.limit).toBe(60);
    expect(res.remaining).toBe(59);
    expect(res.retryAfter).toBeUndefined();
    expect(client.eval).toHaveBeenCalledOnce();
    // Must not have fallen back to in-memory for a successful Redis call
    expect(_getBucketsSize()).toBe(0);
  });

  it("falls back when Redis rejects the atomic operation", async () => {
    vi.spyOn(redisCache, "getRedisClient").mockReturnValue(
      {
        eval: vi.fn().mockRejectedValue(new Error("Redis script failed")),
      } as never
    );

    const res = await checkRateLimit("redis-script-failure", "free");
    expect(res.allowed).toBe(true);
    expect(_getBucketsSize()).toBe(1);
  });

  it.each([{ result: null }, { result: [1, "1", 0] }])(
    "falls back when Redis returns a malformed result %j",
    async ({ result }) => {
      vi.spyOn(redisCache, "getRedisClient").mockReturnValue(
        mockRedisResult(result) as never
      );

      const res = await checkRateLimit("redis-invalid-result", "free");
      expect(res.allowed).toBe(true);
      expect(res.remaining).toBe(59);
      expect(_getBucketsSize()).toBe(1);
    }
  );

  it("blocks via Redis when the window is already full", async () => {
    vi.spyOn(redisCache, "getRedisClient").mockReturnValue(
      mockRedisResult([0, 60, 30]) as never
    );

    const res = await checkRateLimit("redis-full-key", "free");
    expect(res.allowed).toBe(false);
    expect(res.remaining).toBe(0);
    expect(res.retryAfter).toBe(30);
    expect(_getBucketsSize()).toBe(0);
  });
});

// Run against a disposable Redis instance with TEST_REDIS_URL. These cases
// execute the real script; they delete only the unique keys created here.
const redisTestUrl = process.env.TEST_REDIS_URL;
describe.skipIf(!redisTestUrl)("Redis atomic admission integration", () => {
  const clients: Redis[] = [];
  const keys = new Set<string>();
  const runId = globalThis.crypto.randomUUID();

  beforeAll(async () => {
    for (let i = 0; i < 4; i++) {
      clients.push(
        new Redis(redisTestUrl!, {
          lazyConnect: true,
          connectTimeout: 2000,
          maxRetriesPerRequest: 0,
          retryStrategy: () => null,
        })
      );
    }
    await Promise.all(clients.map((client) => client.connect()));
  });

  beforeEach(() => {
    let nextClient = 0;
    vi.spyOn(redisCache, "isRedisEnabled").mockReturnValue(true);
    vi.spyOn(redisCache, "getRedisClient").mockImplementation(
      () => clients[nextClient++ % clients.length]!
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    _clearBuckets();
  });

  afterAll(async () => {
    try {
      if (clients[0]?.status === "ready" && keys.size > 0) {
        await clients[0].del(...keys);
      }
    } finally {
      for (const client of clients) client.disconnect();
    }
  });

  it.each([
    ["free", 60],
    ["partner", 5000],
  ] as const)(
    "admits exactly one concurrent caller for the last %s-tier slot",
    async (tier, limit) => {
      const hashedKey = `atomic-${runId}-${tier}`;
      const key = `oa:rl:${hashedKey}`;
      keys.add(key);
      const now = Date.now();
      vi.spyOn(Date, "now").mockReturnValue(now);
      const seed: Array<string | number> = [];
      for (let i = 0; i < limit - 1; i++) {
        seed.push(now - 1000, `seed-${i}`);
      }
      await clients[0]!.zadd(key, ...seed);

      const results = await Promise.all(
        Array.from({ length: 32 }, () => checkRateLimit(hashedKey, tier))
      );

      expect(results.filter((result) => result.allowed)).toHaveLength(1);
      expect(results.every((result) => result.limit === limit)).toBe(true);
      expect(results.every((result) => result.remaining === 0)).toBe(true);
      expect(
        results
          .filter((result) => !result.allowed)
          .every((result) => (result.retryAfter ?? 0) > 0)
      ).toBe(true);
      expect(await clients[0]!.zcard(key)).toBe(limit);
      expect(await clients[0]!.ttl(key)).toBeGreaterThan(0);
      expect(_getBucketsSize()).toBe(0);
    }
  );

  it("expires entries exactly at the sliding-window boundary", async () => {
    const hashedKey = `atomic-${runId}-boundary`;
    const key = `oa:rl:${hashedKey}`;
    keys.add(key);
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const seed: Array<string | number> = [];
    for (let i = 0; i < 60; i++) seed.push(now - 59_999, `seed-${i}`);
    await clients[0]!.zadd(key, ...seed);

    expect(await checkRateLimit(hashedKey, "free")).toEqual({
      allowed: false,
      limit: 60,
      remaining: 0,
      retryAfter: 1,
    });

    clock.mockReturnValue(now + 1);
    expect(await checkRateLimit(hashedKey, "free")).toEqual({
      allowed: true,
      limit: 60,
      remaining: 59,
      retryAfter: undefined,
    });
    expect(await clients[0]!.zcard(key)).toBe(1);
    expect(_getBucketsSize()).toBe(0);
  });
});

describe("module consolidation invariants", () => {
  it("exposes a single public checkRateLimit entry point (no dual helpers)", async () => {
    const mod = await import("../rateLimit");
    expect(typeof mod.checkRateLimit).toBe("function");
    expect((mod as Record<string, unknown>).checkRateLimitRedis).toBeUndefined();
    expect((mod as Record<string, unknown>).checkRedisRateLimit).toBeUndefined();
    expect((mod as Record<string, unknown>).checkInMemRateLimit).toBeUndefined();
  });
});
