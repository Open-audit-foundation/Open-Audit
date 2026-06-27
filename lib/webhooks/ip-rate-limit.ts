/**
 * Per-IP rate limiter for webhook subscription creation.
 *
 * Limit: 10 registrations per IP per hour.
 * Uses an in-memory sliding window as a lightweight fallback when Redis is
 * unavailable, and a Redis sorted-set sliding window otherwise.
 */

import Redis from "ioredis";
import { NextRequest } from "next/server";

const LIMIT = 10;
const WINDOW_MS = 60 * 60 * 1_000; // 1 hour

// ── In-memory fallback (single-process only) ─────────────────────────────────

const memoryStore = new Map<string, number[]>();

function checkMemory(ip: string): boolean {
  const now = Date.now();
  const windowStart = now - WINDOW_MS;
  const timestamps = (memoryStore.get(ip) ?? []).filter((t) => t > windowStart);
  if (timestamps.length >= LIMIT) return false;
  timestamps.push(now);
  memoryStore.set(ip, timestamps);
  return true;
}

// ── Redis sliding window ──────────────────────────────────────────────────────

let redisClient: Redis | null = null;

function getRedis(): Redis | null {
  if (redisClient) return redisClient;
  if (process.env.REDIS_URL) {
    redisClient = new Redis(process.env.REDIS_URL);
    redisClient.on("error", (err) =>
      console.error("[webhook-ip-rl] Redis error:", err)
    );
  }
  return redisClient;
}

async function checkRedis(ip: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return checkMemory(ip);

  const key = `oa:wh:reg:${ip}`;
  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  const script = `
    local key = KEYS[1]
    local now = tonumber(ARGV[1])
    local window_start = tonumber(ARGV[2])
    local limit = tonumber(ARGV[3])
    local ttl = tonumber(ARGV[4])

    redis.call('ZREMRANGEBYSCORE', key, '-inf', window_start)
    local count = redis.call('ZCARD', key)

    if count < limit then
      redis.call('ZADD', key, now, now .. '-' .. math.random(1000000))
      redis.call('EXPIRE', key, ttl)
      return 1
    else
      return 0
    end
  `;

  try {
    const result = await redis.eval(
      script,
      1,
      key,
      String(now),
      String(windowStart),
      String(LIMIT),
      String(Math.ceil(WINDOW_MS / 1000) + 1)
    );
    return result === 1;
  } catch {
    // Redis unavailable — fall back to in-memory
    return checkMemory(ip);
  }
}

/**
 * Extracts the client IP from a Next.js request.
 */
export function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

/**
 * Returns true if the IP is still under the registration rate limit.
 * Returns false if the limit has been reached (caller should respond 429).
 */
export async function checkWebhookRegistrationRateLimit(
  request: NextRequest
): Promise<boolean> {
  const ip = getClientIp(request);
  return checkRedis(ip);
}
