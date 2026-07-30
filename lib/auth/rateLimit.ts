import type { Tier } from "./apiKey";
import { isRedisEnabled, getRedisClient } from "../cache/redisCache";
import { getRedisClient, isRedisEnabled } from "../cache/redisCache";

// Sliding-window limits in requests per minute per tier
const TIER_LIMITS: Record<Tier, number> = {
  free: 60,
  partner: 5000,
};

const RATE_LIMIT_KEY_PREFIX = "oa:rl:";
const WINDOW_MS = 60_000;
const WINDOW_SECONDS = 60;

// In-memory fallback store: hashedKey -> timestamps of recent requests.
// Entries are created on demand and removed when all timestamps fall outside
// the sliding window, so the Map does not grow without bound.
const buckets = new Map<string, number[]>();

/**
 * Prune all empty or fully expired bucket entries from the in-memory Map.
 */
export function pruneExpiredBuckets(now: number = Date.now()): void {
  const windowMs = 60_000;
  for (const [key, bucket] of buckets.entries()) {
    while (bucket.length > 0 && bucket[0] <= now - windowMs) {
      bucket.shift();
    }
    if (bucket.length === 0) {
      buckets.delete(key);
    }
  }
}

/**
 * Get count of active bucket keys in memory (for testing/inspection).
 */
export function _getBucketsSize(): number {
  return buckets.size;
}

/**
 * Clear in-memory rate limit buckets (for testing).
 */
export function _clearBuckets(): void {
  buckets.clear();
let warnedFallback = false;
function warnInMemoryFallback(reason: string): void {
  if (warnedFallback) return;
  warnedFallback = true;
  console.warn(
    `[rateLimit] Using in-memory rate limiting (${reason}). Limits are ` +
      "per-instance and reset on restart; they are NOT shared across " +
      "horizontally scaled instances."
  );
}

if (!isRedisEnabled()) {
  warnInMemoryFallback("REDIS_URL is not configured");
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfter?: number; // seconds
}

function checkInMemRateLimit(
  hashedKey: string,
  tier: Tier,
  now: number
): RateLimitResult {
  const limit = TIER_LIMITS[tier];
  const windowMs = 60_000;

  let bucket = buckets.get(hashedKey);
  if (!bucket) {
    bucket = [];
  }

  // Remove timestamps older than the sliding window
  while (bucket.length > 0 && bucket[0] <= now - windowMs) {
    bucket.shift();
function checkRateLimitInMemory(hashedKey: string, limit: number): RateLimitResult {
  let bucket = buckets.get(hashedKey);
  const now = Date.now();

  if (bucket) {
    while (bucket.length > 0 && bucket[0] <= now - WINDOW_MS) {
      bucket.shift();
    }

    if (bucket.length === 0) {
      buckets.delete(hashedKey);
    }
  }

  const allowed = (bucket?.length ?? 0) < limit;
  if (allowed) {
    if (!bucket) {
      bucket = [];
    }
    bucket.push(now);
    buckets.set(hashedKey, bucket);
  } else if (bucket.length === 0) {
    buckets.delete(hashedKey);
  }

  if (bucket.length === 0) {
    buckets.delete(hashedKey);
  }

  return {
    allowed,
    limit,
    remaining: Math.max(0, limit - (bucket?.length ?? 0)),
    retryAfter: allowed
      ? undefined
      : bucket
        ? Math.ceil((bucket[0] + WINDOW_MS - now) / 1000)
        : undefined,
  };
}

async function checkRateLimitRedis(hashedKey: string, limit: number): Promise<RateLimitResult> {
  const client = getRedisClient();
  if (!client) {
    throw new Error("Redis client unavailable");
  }

  const key = `${RATE_LIMIT_KEY_PREFIX}${hashedKey}`;
  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  await client.zremrangebyscore(key, 0, windowStart);
  const count = await client.zcard(key);

  const allowed = count < limit;
  if (allowed) {
    const member = `${now}-${Math.random().toString(36).slice(2, 10)}`;
    await client.zadd(key, now, member);
    await client.expire(key, WINDOW_SECONDS);
  }

  let retryAfter: number | undefined;
  if (!allowed) {
    const oldest = await client.zrange(key, 0, 0, "WITHSCORES");
    const oldestScore = oldest.length > 1 ? Number(oldest[1]) : now;
    retryAfter = Math.max(1, Math.ceil((oldestScore + WINDOW_MS - now) / 1000));
  }

  return {
    allowed,
    limit,
    remaining: Math.max(0, limit - (allowed ? count + 1 : count)),
    retryAfter,
  };
}

async function checkRedisRateLimit(
  hashedKey: string,
  tier: Tier,
  now: number
): Promise<RateLimitResult> {
  const redis = getRedisClient();
  if (!redis) {
    throw new Error("Redis client not available");
  }

  const limit = TIER_LIMITS[tier];
  const windowMs = 60_000;
  const key = `oa:rl:${hashedKey}`;
  const clearBefore = now - windowMs;
  const member = `${now}:${Math.random().toString(36).substring(2, 9)}`;

  const pipeline = redis.pipeline();
  pipeline.zremrangebyscore(key, 0, clearBefore);
  pipeline.zcard(key);
  const results = await pipeline.exec();

  if (!results) {
    throw new Error("Redis pipeline returned null");
  }

  const zcardRes = results[1];
  if (zcardRes[0]) {
    throw zcardRes[0];
  }

  const currentCount = zcardRes[1] as number;
  const allowed = currentCount < limit;

  if (allowed) {
    const addPipeline = redis.pipeline();
    addPipeline.zadd(key, now, member);
    addPipeline.expire(key, 60);
    await addPipeline.exec();
  }

  const newCount = allowed ? currentCount + 1 : currentCount;
  const remaining = Math.max(0, limit - newCount);

  let retryAfter: number | undefined;
  if (!allowed) {
    const oldestScores = await redis.zrange(key, 0, 0, "WITHSCORES");
    if (oldestScores && oldestScores.length >= 2) {
      const oldestTs = parseFloat(oldestScores[1]);
      retryAfter = Math.ceil((oldestTs + windowMs - now) / 1000);
    } else {
      retryAfter = 60;
    }
  }

  return {
    allowed,
    limit,
    remaining,
    retryAfter: allowed ? undefined : Math.max(1, retryAfter ?? 60),
  };
}

/**
 * Sliding-window rate limiter.
 *
 * Primary mode: Redis sorted set (`oa:rl:{hashedKey}`) when `REDIS_URL` is configured.
 * Key: oa:rl:{hashedKey}
 * Members: unique timestamps of recent requests ({timestamp}:{random})
 * Window: 60 seconds
 * Key TTL: 60 seconds (automatically evicts inactive keys in Redis)
 *
 * Fallback mode: In-memory sliding-window bucket map when Redis is unconfigured
 * or unavailable.
 * Eviction: Automatically removes keys from memory when their request timestamps expire.
 * Limitations: Per-instance scoping (no cross-node state) and reset on server restart.
/**
 * Sliding-window rate limiter.
 *
 * Primary path: a Redis sorted set.
 *   Key: oa:rl:{hashedKey}
 *   Members: unique per-request ids
 *   Scores: request timestamps (ms)
 *   Window: 60 seconds
 * This makes limits persistent across restarts and shared across all
 * server instances pointed at the same Redis.
 *
 * Fallback path: when REDIS_URL is not configured, or a Redis command
 * fails, this falls back to an in-process Map of timestamps per
 * hashedKey (a warning is logged once). In fallback mode, limits are
 * per-instance only — a horizontally scaled deployment gives each
 * instance its own independent allocation — and reset whenever the
 * process restarts.
 */
export async function checkRateLimit(
  hashedKey: string,
  tier: Tier
): Promise<RateLimitResult> {
  const now = Date.now();
  if (isRedisEnabled()) {
    try {
      return await checkRedisRateLimit(hashedKey, tier, now);
    } catch (err) {
      console.warn("[rateLimit] Redis rate limiter error, falling back to in-memory:", err);
    }
  }
  return checkInMemRateLimit(hashedKey, tier, now);
  const limit = TIER_LIMITS[tier];

  if (isRedisEnabled()) {
    try {
      return await checkRateLimitRedis(hashedKey, limit);
    } catch (err) {
      warnInMemoryFallback(`Redis error: ${(err as Error).message}`);
    }
  }

  return checkRateLimitInMemory(hashedKey, limit);
}
