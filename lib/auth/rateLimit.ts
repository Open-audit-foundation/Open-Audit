import Redis from "ioredis";
import type { Tier } from "./apiKey";

// Sliding-window limits in requests per minute per tier
const TIER_LIMITS: Record<Tier, number> = {
  free: 60,
  partner: 5000,
};

let client: Redis | null = null;

function getRedis(): Redis | null {
  if (!process.env.REDIS_URL) return null;
  if (!client) {
    client = new Redis(process.env.REDIS_URL);
    client.on("error", (err) => console.error("[rate-limit] redis error:", err));
  }
  return client;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfter?: number; // seconds
}

/**
 * Sliding-window rate limiter using a Redis sorted set.
 *
 * Key: oa:rl:{hashedKey}
 * Members: timestamps of recent requests
 * Window: 60 seconds
 */
export async function checkRateLimit(
  hashedKey: string,
  tier: Tier
): Promise<RateLimitResult> {
  const limit = TIER_LIMITS[tier];
  const redis = getRedis();

  // No Redis → fail open so the app still works without it
  if (!redis) {
    return { allowed: true, limit, remaining: limit };
  }

  const key = `oa:rl:${hashedKey}`;
  const now = Date.now();
  const windowMs = 60_000;
  const windowStart = now - windowMs;

  // Atomic sliding-window with a Lua script to avoid race conditions
  const script = `
    local key = KEYS[1]
    local now = tonumber(ARGV[1])
    local window_start = tonumber(ARGV[2])
    local limit = tonumber(ARGV[3])
    local ttl = tonumber(ARGV[4])

    redis.call('ZREMRANGEBYSCORE', key, '-inf', window_start)
    local count = redis.call('ZCARD', key)

    if count < limit then
      redis.call('ZADD', key, now, now)
      redis.call('EXPIRE', key, ttl)
      return {1, limit - count - 1}
    else
      return {0, 0}
    end
  `;

  const result = (await redis.eval(
    script,
    1,
    key,
    String(now),
    String(windowStart),
    String(limit),
    String(Math.ceil(windowMs / 1000) + 1)
  )) as [number, number];

  const allowed = result[0] === 1;
  const remaining = result[1];

  if (!allowed) {
    // Tell the client roughly how long to wait (until oldest entry expires)
    const oldest = await redis.zrange(key, 0, 0, "WITHSCORES");
    const oldestTs = oldest[1] ? Number(oldest[1]) : now;
    const retryAfter = Math.ceil((oldestTs + windowMs - now) / 1000);
    return { allowed: false, limit, remaining: 0, retryAfter };
  }

  return { allowed: true, limit, remaining };
}
