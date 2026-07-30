import type { Tier } from "./apiKey";
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
