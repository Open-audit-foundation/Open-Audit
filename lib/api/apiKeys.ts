import crypto from "crypto";
import { ApiKey, DeveloperTier } from "./types";

const API_KEY_PREFIX = "oa_live";
const KEY_LENGTH = 32;

export function generateApiKey(): { key: string; hash: string; prefix: string } {
  const key = crypto.randomBytes(KEY_LENGTH).toString("hex");
  const fullKey = `${API_KEY_PREFIX}_${key}`;
  const hash = hashApiKey(fullKey);
  return { key: fullKey, hash, prefix: API_KEY_PREFIX };
}

export function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

export function validateApiKeyFormat(key: string): boolean {
  return key.startsWith(`${API_KEY_PREFIX}_`) && key.length === API_KEY_PREFIX.length + 1 + KEY_LENGTH * 2;
}

const MOCK_API_KEYS: Map<string, ApiKey> = new Map();

export function initMockApiKeys(): void {
  const { hash, prefix } = generateApiKey();
  MOCK_API_KEYS.set(hash, {
    id: "1",
    prefix,
    keyHash: hash,
    appId: "app-1",
    userId: "user-1",
    tier: "free",
    isActive: true,
    createdAt: new Date(),
  });
}

export async function getApiKeyByHash(hash: string): Promise<ApiKey | null> {
  if (MOCK_API_KEYS.size === 0) initMockApiKeys();
  return MOCK_API_KEYS.get(hash) || null;
}
