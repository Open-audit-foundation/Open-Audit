import { createHash, randomBytes } from "crypto";

export type Tier = "free" | "partner";

export interface ApiKeyRecord {
  hashedKey: string;
  tier: Tier;
  appName: string;
}

const API_KEY_PREFIX = "oa_live";
const KEY_ENTROPY_BYTES = 24;

export function hashKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

export function validateApiKeyFormat(key: string): boolean {
  const expectedLength = API_KEY_PREFIX.length + 1 + KEY_ENTROPY_BYTES * 2;
  return key.startsWith(`${API_KEY_PREFIX}_`) && key.length === expectedLength;
}

export function generateApiKey(): { key: string; hash: string; prefix: string } {
  const entropy = randomBytes(KEY_ENTROPY_BYTES).toString("hex");
  const fullKey = `${API_KEY_PREFIX}_${entropy}`;
  const hash = hashKey(fullKey);
  return { key: fullKey, hash, prefix: API_KEY_PREFIX };
}

function loadKeyRegistry(): ApiKeyRecord[] {
  const raw = process.env.OA_API_KEYS ?? "";
  if (!raw) return [];

  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [hashedKey, tier, ...rest] = entry.split(":");
      return {
        hashedKey,
        tier: (tier as Tier) ?? "free",
        appName: rest.join(":") || "unknown",
      };
    });
}

export function validateApiKey(rawKey: string): ApiKeyRecord | null {
  if (!rawKey || !validateApiKeyFormat(rawKey)) return null;

  const hashed = hashKey(rawKey);
  const registry = loadKeyRegistry();
  return registry.find((r) => r.hashedKey === hashed) ?? null;
}
