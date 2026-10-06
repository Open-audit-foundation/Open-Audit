import type { Tier } from "./apiKey";
import { getRedisClient, isRedisEnabled } from "../cache/redisCache";

/** Sliding-window limits in requests per minute per tier. */
const TIER_LIMITS: Record<Tier, number> = {
  free: 60,
  partner: 5000,
};

const RATE_LIMIT_KEY_PREFIX = "oa:rl:";
const WINDOW_MS = 60_000;
const WINDOW_SECONDS = 60;

// Keep the decision and admission in one Redis operation. Pipelining the count
// and write separately lets concurrent callers all consume the same last slot.
const REDIS_SLIDING_WINDOW_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])

redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local count = redis.call('ZCARD', key)

if count < limit then
  redis.call('ZADD', key, now, ARGV[4])
  redis.call('EXPIRE', key, tonumber(ARGV[5]))
  return {1, count + 1, 0}
end

local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local retryAfter = tonumber(ARGV[5])
if #oldest >= 2 then
  retryAfter = math.max(1, math.ceil((tonumber(oldest[2]) + window - now) / 1000))
end
return {0, count, retryAfter}
`;

/**
 * In-memory fallback store: hashedKey -> timestamps of recent requests.
 * Entries are created on demand and removed when all timestamps fall outside
 * the sliding window, so the Map does not grow without bound.
 */
const buckets = new Map<string, number[]>();
let lastExpiredBucketSweepAt: number | undefined;

/** Remove an expired sorted prefix with at most one compaction. */
function pruneBucket(bucket: number[], cutoff: number): void {
  if (bucket.length === 0 || !(bucket[0] <= cutoff)) return;
  if (bucket[bucket.length - 1] <= cutoff) {
    bucket.length = 0;
    return;
  }

  // Find the first timestamp strictly inside the window. Equal timestamps
  // expire together, including after a backward clock adjustment.
  let low = 1;
  let high = bucket.length - 1;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (bucket[middle] <= cutoff) low = middle + 1;
    else high = middle;
  }
  bucket.splice(0, low);
}

/**
 * Prune all empty or fully expired bucket entries from the in-memory Map.
 */
export function pruneExpiredBuckets(now: number = Date.now()): void {
  for (const [key, bucket] of buckets.entries()) {
    pruneBucket(bucket, now - WINDOW_MS);
    if (bucket.length === 0) {
      buckets.delete(key);
    }
  }
}

/** Bound full-map cleanup to at most once per sliding-window interval. */
function maybePruneExpiredBuckets(now: number): void {
  if (
    lastExpiredBucketSweepAt !== undefined &&
    now >= lastExpiredBucketSweepAt &&
    now - lastExpiredBucketSweepAt < WINDOW_MS
  ) {
    return;
  }

  pruneExpiredBuckets(now);
  lastExpiredBucketSweepAt = now;
}

/** Count of active bucket keys in memory (for testing/inspection). */
export function _getBucketsSize(): number {
  return buckets.size;
}

/** Clear in-memory rate limit buckets (for testing). */
export function _clearBuckets(): void {
  buckets.clear();
  lastExpiredBucketSweepAt = undefined;
}

let warnedFallback = false;
let warnedRedisError = false;
function warnInMemoryFallback(reason: string): void {
  if (warnedFallback) return;
  warnedFallback = true;
  console.warn(
    `[rateLimit] Using in-memory rate limiting (${reason}). Limits are ` +
      "per-instance and reset on restart; they are NOT shared across " +
      "horizontally scaled instances."
  );
}

// Module-load warning: must run at import time, not inside a test helper.
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
  let bucket = buckets.get(hashedKey);

  if (bucket) {
    pruneBucket(bucket, now - WINDOW_MS);
    if (bucket.length === 0) {
      buckets.delete(hashedKey);
      bucket = undefined;
    }
  }

  const currentLength = bucket?.length ?? 0;
  const allowed = currentLength < limit;

  if (allowed) {
    if (!bucket) {
      bucket = [];
    }
    // Redis failures can finish out of request order. Keep the oldest timestamp
    // first so expiry does not leave an expired request behind newer entries.
    let insertAt = bucket.length;
    while (insertAt > 0 && bucket[insertAt - 1] > now) {
      insertAt--;
    }
    bucket.splice(insertAt, 0, now);
    buckets.set(hashedKey, bucket);
  }

  return {
    allowed,
    limit,
    remaining: Math.max(0, limit - (allowed ? currentLength + 1 : currentLength)),
    retryAfter: allowed
      ? undefined
      : bucket
        ? Math.ceil((bucket[0] + WINDOW_MS - now) / 1000)
        : 60,
  };
}

/**
 * Redis sorted-set sliding window (shared across instances).
 * Atomically prunes, checks and admits a request, with one network round trip.
 */
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
  const key = `${RATE_LIMIT_KEY_PREFIX}${hashedKey}`;
  const member = `${now}:${globalThis.crypto.randomUUID()}`;
  const result = await redis.eval(
    REDIS_SLIDING_WINDOW_SCRIPT,
    1,
    key,
    now,
    WINDOW_MS,
    limit,
    member,
    WINDOW_SECONDS
  );

  if (
    !Array.isArray(result) ||
    result.length !== 3 ||
    (result[0] !== 0 && result[0] !== 1) ||
    !Number.isInteger(result[1]) ||
    result[1] < 0 ||
    !Number.isInteger(result[2]) ||
    result[2] < 0
  ) {
    throw new Error("Redis returned an invalid rate-limit result");
  }

  const [admitted, currentCount, retryAfter] = result as [number, number, number];
  const allowed = admitted === 1;

  return {
    allowed,
    limit,
    remaining: Math.max(0, limit - currentCount),
    retryAfter: allowed ? undefined : Math.max(1, retryAfter ?? WINDOW_SECONDS),
  };
}

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
  maybePruneExpiredBuckets(now);

  if (isRedisEnabled()) {
    try {
      return await checkRedisRateLimit(hashedKey, tier, now);
    } catch (err) {
      // Preserve the first error diagnostic without logging every failed request.
      if (!warnedRedisError) {
        warnedRedisError = true;
        console.warn(
          "[rateLimit] Redis rate limiter error, falling back to in-memory:",
          err
        );
      }
      warnInMemoryFallback("Redis command failed");
    }
  }
  // A Redis failure may arrive much later; evaluate the fallback window when
  // admission is decided, rather than consuming it while waiting for Redis.
  return checkInMemRateLimit(hashedKey, tier, Date.now());
}
