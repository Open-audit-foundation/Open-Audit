const API_KEY_PREFIX = "oa_live";
const KEY_ENTROPY_BYTES = 24;

export type Tier = "free" | "partner";

export interface ApiKeyRecord {
  hashedKey: string;
  tier: Tier;
  appName: string;
}

export async function hashKey(rawKey: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(rawKey);
  const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function validateApiKeyFormat(key: string): boolean {
  const expectedLength = API_KEY_PREFIX.length + 1 + KEY_ENTROPY_BYTES * 2;
  return key.startsWith(`${API_KEY_PREFIX}_`) && key.length === expectedLength;
}

export async function generateApiKey(): Promise<{ key: string; hash: string; prefix: string }> {
  const entropy = globalThis.crypto.getRandomValues(new Uint8Array(KEY_ENTROPY_BYTES));
  const entropyHex = Array.from(entropy).map((b) => b.toString(16).padStart(2, "0")).join("");
  const fullKey = `${API_KEY_PREFIX}_${entropyHex}`;
  const hash = await hashKey(fullKey);
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

export async function validateApiKey(rawKey: string): Promise<ApiKeyRecord | null> {
  if (!rawKey || !validateApiKeyFormat(rawKey)) return null;

  const hashed = await hashKey(rawKey);
  const registry = loadKeyRegistry();
  return registry.find((r) => r.hashedKey === hashed) ?? null;
}
