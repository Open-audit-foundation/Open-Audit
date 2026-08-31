import crypto from "crypto";
import Redis from "ioredis";
import { ApiKey, DeveloperTier } from "./types";
import { db } from "@/lib/db/client";

const API_KEY_PREFIX = "oa_live";
const KEY_LENGTH = 32;
const REDIS_CACHE_TTL_SECONDS = 300;
const REDIS_CACHE_KEY_PREFIX = "oa:apikey:";

let redisClient: Redis | null = null;

function getRedis(): Redis | null {
  if (!process.env.REDIS_URL) return null;
  if (!redisClient) {
    redisClient = new Redis(process.env.REDIS_URL);
    redisClient.on("error", (err) => {
      console.error("[apikeys] Redis client error:", err);
    });
  }
  return redisClient;
}

function makeRedisCacheKey(hashedKey: string): string {
  return `${REDIS_CACHE_KEY_PREFIX}${hashedKey}`;
}

export function generateApiKey(): { key: string; hash: string; prefix: "oa_live" | "oa_test" } {
  const key = crypto.randomBytes(KEY_LENGTH).toString("hex");
  const fullKey = `${API_KEY_PREFIX}_${key}`;
  const hash = hashApiKey(fullKey);
  return { key: fullKey, hash, prefix: API_KEY_PREFIX as "oa_live" };
}

export function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

export function validateApiKeyFormat(key: string): boolean {
  return key.startsWith(`${API_KEY_PREFIX}_`) && key.length === API_KEY_PREFIX.length + 1 + KEY_LENGTH * 2;
}

function dbRowToApiKey(row: {
  id: string;
  hashedKey: string;
  appName: string;
  owner: string;
  tier: string;
  isActive: boolean;
  createdAt: Date;
  lastUsedAt: Date | null;
}): ApiKey {
  return {
    id: row.id,
    prefix: API_KEY_PREFIX,
    keyHash: row.hashedKey,
    appId: row.appName,
    userId: row.owner,
    tier: row.tier as DeveloperTier,
    isActive: row.isActive,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt ?? undefined,
  };
}

export interface IssueApiKeyParams {
  appName: string;
  owner: string;
  tier: DeveloperTier;
}

export async function issueApiKey(params: IssueApiKeyParams): Promise<{ rawKey: string; record: ApiKey }> {
  const { key: rawKey, hash: hashedKey, prefix } = generateApiKey();

  const row = await db.apiKey.create({
    data: {
      hashedKey,
      appName: params.appName,
      owner: params.owner,
      tier: params.tier,
      isActive: true,
    },
  });

  const record: ApiKey = {
    id: row.id,
    prefix,
    keyHash: hashedKey,
    appId: params.appName,
    userId: params.owner,
    tier: params.tier,
    isActive: true,
    createdAt: row.createdAt,
  };

  return { rawKey, record };
}

export async function revokeApiKeyById(id: string): Promise<boolean> {
  try {
    const row = await db.apiKey.update({
      where: { id },
      data: { isActive: false },
      select: { hashedKey: true },
    });
    await invalidateCache(row.hashedKey);
    return true;
  } catch {
    return false;
  }
}

export async function revokeApiKeyByHash(hashedKey: string): Promise<boolean> {
  try {
    await db.apiKey.update({
      where: { hashedKey },
      data: { isActive: false },
    });
    await invalidateCache(hashedKey);
    return true;
  } catch {
    return false;
  }
}

async function invalidateCache(hashedKey: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.del(makeRedisCacheKey(hashedKey));
  } catch (err) {
    console.warn("[apikeys] Failed to invalidate Redis cache:", err);
  }
}

async function readCache(hashedKey: string): Promise<ApiKey | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(makeRedisCacheKey(hashedKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      ...parsed,
      createdAt: new Date(parsed.createdAt),
      lastUsedAt: parsed.lastUsedAt ? new Date(parsed.lastUsedAt) : undefined,
    };
  } catch (err) {
    console.warn("[apikeys] Failed to read Redis cache:", err);
    return null;
  }
}

async function writeCache(record: ApiKey): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    const serializable = {
      ...record,
      createdAt: record.createdAt.toISOString(),
      lastUsedAt: record.lastUsedAt ? record.lastUsedAt.toISOString() : null,
    };
    await redis.set(
      makeRedisCacheKey(record.keyHash),
      JSON.stringify(serializable),
      "EX",
      REDIS_CACHE_TTL_SECONDS
    );
  } catch (err) {
    console.warn("[apikeys] Failed to write Redis cache:", err);
  }
}

function touchLastUsedAtNonBlocking(id: string): void {
  setImmediate(async () => {
    try {
      await db.apiKey.update({
        where: { id },
        data: { lastUsedAt: new Date() },
      });
    } catch (err) {
      console.warn("[apikeys] Failed to update lastUsedAt:", err);
    }
  });
}

export async function getApiKeyByHash(hashedKey: string): Promise<ApiKey | null> {
  const cached = await readCache(hashedKey);
  if (cached) {
    if (cached.isActive) {
      touchLastUsedAtNonBlocking(cached.id);
      return cached;
    }
    return null;
  }

  const row = await db.apiKey.findUnique({
    where: { hashedKey },
  });

  if (!row) {
    return null;
  }

  const record = dbRowToApiKey(row);
  await writeCache(record);

  if (!record.isActive) {
    return null;
  }

  touchLastUsedAtNonBlocking(record.id);
  return record;
}

export async function validateApiKey(rawKey: string): Promise<ApiKey | null> {
  if (!validateApiKeyFormat(rawKey)) {
    return null;
  }
  const hashed = hashApiKey(rawKey);
  return getApiKeyByHash(hashed);
}

export async function disconnectApiKeyRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}
