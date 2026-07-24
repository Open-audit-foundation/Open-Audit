import Redis from "ioredis";
import type { RawEvent, TranslatedEvent } from "../translator/types";
import { redisCacheHitsTotal, redisCacheMissesTotal } from "../metrics";

let client: Redis | null = null;
const CACHE_NAMESPACE = "open-audit";
const EVENTS_CACHE_PREFIX = `${CACHE_NAMESPACE}:events`;
const TRANSLATION_CACHE_PREFIX = `${CACHE_NAMESPACE}:translation`;
const STATS_CACHE_PREFIX = `${CACHE_NAMESPACE}:stats`;
const STATS_CACHE_TTL = 30;

export function isRedisEnabled(): boolean {
  return Boolean(process.env.REDIS_URL);
}

export function initRedis(): void {
  if (!isRedisEnabled()) return;
  if (client) return;
  client = new Redis(process.env.REDIS_URL as string);
  client.on("error", (err) => {
    console.error("[redis] Redis client error:", err);
  });
}

function makeKey(sorobanUrl: string, contractIds: string[], startLedger: number) {
  const ids = contractIds.join(",");
  return `${EVENTS_CACHE_PREFIX}:${sorobanUrl}:${ids}:${startLedger}`;
}

function makeTranslationKey(txHash: string, eventId: string) {
  return `${TRANSLATION_CACHE_PREFIX}:${txHash}:${eventId}`;
}

export async function getCachedEvents(
  sorobanUrl: string,
  contractIds: string[],
  startLedger: number
): Promise<any | null> {
  if (!isRedisEnabled()) return null;
  try {
    if (!client) initRedis();
    if (!client) return null;
    const key = makeKey(sorobanUrl, contractIds, startLedger);
    const raw = await client.get(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    console.warn("[redis] Error reading cache:", err);
    return null;
  }
}

export async function setCachedEvents(
  sorobanUrl: string,
  contractIds: string[],
  startLedger: number,
  value: any
): Promise<void> {
  if (!isRedisEnabled()) return;
  try {
    if (!client) initRedis();
    if (!client) return;
    const key = makeKey(sorobanUrl, contractIds, startLedger);
    const ttl = process.env.REDIS_TTL_SECONDS
      ? parseInt(process.env.REDIS_TTL_SECONDS, 10)
      : 0;
    const raw = JSON.stringify(value);
    if (ttl > 0) {
      await client.set(key, raw, "EX", ttl);
    } else {
      await client.set(key, raw);
    }
  } catch (err) {
    console.warn("[redis] Error writing cache:", err);
  }
}

export async function getCachedTranslation(
  event: Pick<RawEvent, "txHash" | "id">
): Promise<TranslatedEvent | null> {
  if (!isRedisEnabled()) return null;
  try {
    if (!client) initRedis();
    if (!client) return null;
    const key = makeTranslationKey(event.txHash, event.id);
    const raw = await client.get(key);
    if (!raw) {
      redisCacheMissesTotal.inc();
      return null;
    }
    redisCacheHitsTotal.inc();
    return JSON.parse(raw) as TranslatedEvent;
  } catch (err) {
    console.warn("[redis] Error reading translation cache:", err);
    return null;
  }
}

export async function setCachedTranslation(
  event: Pick<RawEvent, "txHash" | "id">,
  translated: TranslatedEvent
): Promise<void> {
  if (!isRedisEnabled()) return;
  try {
    if (!client) initRedis();
    if (!client) return;
    const key = makeTranslationKey(event.txHash, event.id);
    await client.set(key, JSON.stringify(translated));
  } catch (err) {
    console.warn("[redis] Error writing translation cache:", err);
  }
}

export async function purgeTranslationCache(
  matchPattern: string = `${TRANSLATION_CACHE_PREFIX}:*`
): Promise<number> {
  if (!isRedisEnabled()) return 0;
  try {
    if (!client) initRedis();
    if (!client) return 0;

    const keys: string[] = [];
    let cursor = "0";
    do {
      const [nextCursor, batch] = await client.scan(cursor, "MATCH", matchPattern, "COUNT", "100");
      cursor = nextCursor;
      keys.push(...batch);
    } while (cursor !== "0");

    if (keys.length === 0) return 0;
    await client.del(...keys);
    return keys.length;
  } catch (err) {
    console.warn("[redis] Error purging translation cache:", err);
    return 0;
  }
}

export async function disconnectRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
  }
}

export async function getCachedStats(): Promise<any | null> {
  if (!isRedisEnabled()) return null;
  try {
    if (!client) initRedis();
    if (!client) return null;
    const key = `${STATS_CACHE_PREFIX}:global`;
    const raw = await client.get(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    console.warn("[redis] Error reading stats cache:", err);
    return null;
  }
}

export async function setCachedStats(value: any): Promise<void> {
  if (!isRedisEnabled()) return;
  try {
    if (!client) initRedis();
    if (!client) return;
    const key = `${STATS_CACHE_PREFIX}:global`;
    await client.set(key, JSON.stringify(value), "EX", STATS_CACHE_TTL);
  } catch (err) {
    console.warn("[redis] Error writing stats cache:", err);
  }
}
