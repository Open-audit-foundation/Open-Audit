import { DeveloperTier, RATE_LIMITS } from "./types";

const inMemoryBuckets = new Map<string, number[]>();

function getBucket(apiKeyId: string): number[] {
  const existing = inMemoryBuckets.get(apiKeyId);
  if (existing) {
    return existing;
  }

  const created: number[] = [];
  inMemoryBuckets.set(apiKeyId, created);
  return created;
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
  const limit = RATE_LIMITS[tier].requestsPerMinute;
  const now = Date.now();
  const windowMs = 60 * 1000;
  const bucket = getBucket(apiKeyId);

  while (bucket.length > 0 && bucket[0] <= now - windowMs) {
    bucket.shift();
  }

  const allowed = bucket.length < limit;
  if (allowed) {
    bucket.push(now);
  }

  return {
    allowed,
    remaining: Math.max(0, limit - bucket.length),
    resetAfter: 60,
  };
}
