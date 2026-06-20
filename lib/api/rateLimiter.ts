import Redis from "ioredis";
import { DeveloperTier, RATE_LIMITS } from "./types";

let redisClient: Redis | null = null;

function getRedis(): Redis | null {
  if (redisClient) return redisClient;
  if (process.env.REDIS_URL) {
    redisClient = new Redis(process.env.REDIS_URL);
    redisClient.on("error", (err) => console.error("[rate-limiter] Redis error:", err));
  }
  return redisClient;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAfter: number;
}

export async function checkRateLimit(
  apiKeyId: string,
  tier: DeveloperTier
): Promise<RateLimitResult> {
  const redis = getRedis();
  const limit = RATE_LIMITS[tier].requestsPerMinute;
  const now = Date.now();
  const windowMs = 60 * 1000;
  const key = `rate_limit:${apiKeyId}`;

  if (!redis) {
    return { allowed: true, remaining: limit, resetAfter: 60 };
  }

  const pipeline = redis.pipeline();
  pipeline.zremrangebyscore(key, 0, now - windowMs);
  pipeline.zadd(key, now, `${now}-${Math.random()}`);
  pipeline.zcard(key);
  pipeline.expire(key, Math.ceil(windowMs / 1000));

  const results = await pipeline.exec();
  const count = results?.[2]?.[1] as number || 0;

  const allowed = count <= limit;
  const remaining = Math.max(0, limit - count);
  const resetAfter = 60;

  return { allowed, remaining, resetAfter };
}
