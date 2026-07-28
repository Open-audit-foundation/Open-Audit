import type { Tier } from "./apiKey";
import { isRedisEnabled, getRedisClient } from "../cache/redisCache";

// Sliding-window limits in requests per minute per tier
const TIER_LIMITS: Record<Tier, number> = {
  free: 60,
  partner: 5000,
};

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
  }

  const allowed = bucket.length < limit;
  if (allowed) {
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
    remaining: Math.max(0, limit - bucket.length),
    retryAfter: allowed ? undefined : Math.ceil((bucket[0] + windowMs - now) / 1000),
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
}
