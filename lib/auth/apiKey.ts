// Use Web Crypto API for Edge Runtime compatibility

// Developer tiers with their rate limits (requests per minute)
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

/**
 * Loads API key records from the OA_API_KEYS env var.
 *
 * Format: comma-separated entries of "hashedKey:tier:appName"
 * e.g. OA_API_KEYS="abc123...:free:my-app,def456...:partner:big-client"
 *
 * In practice you'd back this with a database. This is the lightweight
 * env-based version that's easy to operate without standing up a DB.
 */
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

/**
 * Validates an incoming API key header value.
 * Returns the matching record if valid, null otherwise.
 */
export async function validateApiKey(rawKey: string): Promise<ApiKeyRecord | null> {
  if (!rawKey || !rawKey.startsWith("oa_live_")) return null;

  const hashed = await hashKey(rawKey);
  const registry = loadKeyRegistry();
  return registry.find((r) => r.hashedKey === hashed) ?? null;
}
