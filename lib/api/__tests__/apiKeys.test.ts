import {
  describe,
  it,
  expect,
  beforeEach,
  beforeAll,
  afterAll,
  vi,
  type Mock,
} from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  issueApiKey,
  revokeApiKeyById,
  revokeApiKeyByHash,
  validateApiKey,
  getApiKeyByHash,
  hashApiKey,
  validateApiKeyFormat,
  generateApiKey,
  disconnectApiKeyRedis,
} from "../apiKeys";
import { parseEnvApiKeys, upsertEnvApiKeys } from "../../../scripts/migrate-env-apikeys";
import type { ApiKey } from "../types";

vi.mock("@/lib/db/client", () => {
  const mockCreate = vi.fn();
  const mockUpdate = vi.fn();
  const mockFindUnique = vi.fn();
  const mockUpsert = vi.fn();

  const apiKey = {
    create: mockCreate,
    update: mockUpdate,
    findUnique: mockFindUnique,
    upsert: mockUpsert,
  };

  return {
    db: {
      apiKey,
    },
    __mock: {
      mockCreate,
      mockUpdate,
      mockFindUnique,
      mockUpsert,
    },
  };
});

const MockRedis = vi.hoisted(() => {
  const store = new Map<string, string>();
  return vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    get: vi.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    set: vi.fn((key: string, value: string, _mode?: string, _ttl?: number) => {
      store.set(key, value);
      return Promise.resolve("OK");
    }),
    del: vi.fn((key: string) => {
      const existed = store.has(key);
      store.delete(key);
      return Promise.resolve(existed ? 1 : 0);
    }),
    quit: vi.fn(() => Promise.resolve("OK")),
    __store: store,
  }));
});

vi.mock("ioredis", () => ({
  default: MockRedis,
}));

import { db } from "@/lib/db/client";

const mockPrism = db as unknown as {
  apiKey: {
    create: Mock;
    update: Mock;
    findUnique: Mock;
    upsert: Mock;
  };
};

describe("lib/api/apiKeys.ts - Issuance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (MockRedis as unknown as any).mock.results.forEach((r: any) => {
      if (r.value && r.value.__store) {
        r.value.__store.clear();
      }
    });
    process.env.REDIS_URL = "redis://localhost:6379";
  });

  afterAll(async () => {
    await disconnectApiKeyRedis();
    delete process.env.REDIS_URL;
  });

  it("issueApiKey returns raw key exactly once and persists only its hash in DB", async () => {
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    mockPrism.apiKey.create.mockResolvedValue({
      id: "cl_testid123",
      createdAt,
    });

    const result = await issueApiKey({
      appName: "test-app",
      owner: "test-owner",
      tier: "free",
    });

    expect(typeof result.rawKey).toBe("string");
    expect(result.rawKey.startsWith("oa_live_")).toBe(true);
    expect(validateApiKeyFormat(result.rawKey)).toBe(true);

    const expectedHash = hashApiKey(result.rawKey);
    expect(result.record.keyHash).toBe(expectedHash);

    expect(mockPrism.apiKey.create).toHaveBeenCalledTimes(1);
    const createArg = mockPrism.apiKey.create.mock.calls[0][0];
    expect(createArg.data.hashedKey).toBe(expectedHash);
    expect(createArg.data).not.toHaveProperty("rawKey");
    expect(createArg.data.appName).toBe("test-app");
    expect(createArg.data.owner).toBe("test-owner");
    expect(createArg.data.tier).toBe("free");
    expect(createArg.data.isActive).toBe(true);

    expect(result.record.keyHash).not.toBe(result.rawKey);
    expect(result.rawKey.length).toBeGreaterThan(0);
  });

  it("issueApiKey generates cryptographically unique keys on successive calls", async () => {
    let seq = 0;
    mockPrism.apiKey.create.mockImplementation(() =>
      Promise.resolve({ id: `cl_seq${seq++}`, createdAt: new Date() })
    );

    const a = await issueApiKey({ appName: "a", owner: "o", tier: "free" });
    const b = await issueApiKey({ appName: "b", owner: "o", tier: "partner" });

    expect(a.rawKey).not.toBe(b.rawKey);
    expect(a.record.keyHash).not.toBe(b.record.keyHash);
    expect(a.record.tier).toBe("free");
    expect(b.record.tier).toBe("partner");
  });

  it("generateApiKey / hashApiKey helpers are deterministic and correct", () => {
    const { key, hash } = generateApiKey();
    expect(hashApiKey(key)).toBe(hash);
    expect(key.startsWith("oa_live_")).toBe(true);
    expect(validateApiKeyFormat(key)).toBe(true);
    expect(validateApiKeyFormat("bogus")).toBe(false);
    expect(validateApiKeyFormat("oa_live_short")).toBe(false);
  });
});

describe("lib/api/apiKeys.ts - Revocation & Cache Invalidation", () => {
  let redisInstance: ReturnType<typeof MockRedis>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.REDIS_URL = "redis://localhost:6379";
    redisInstance = new MockRedis() as any;
    (redisInstance as any).__store.clear();
  });

  afterAll(async () => {
    await disconnectApiKeyRedis();
    delete process.env.REDIS_URL;
  });

  it("revokeApiKeyById flips isActive=false and invalidates Redis cache immediately", async () => {
    const hashedKey = "deadbeefhash123";
    const recordId = "cl_revokeme";

    mockPrism.apiKey.update.mockResolvedValue({ hashedKey });

    const revoked = await revokeApiKeyById(recordId);
    expect(revoked).toBe(true);

    expect(mockPrism.apiKey.update).toHaveBeenCalledWith({
      where: { id: recordId },
      data: { isActive: false },
      select: { hashedKey: true },
    });

    const cacheKey = `oa:apikey:${hashedKey}`;
    expect(redisInstance.del).toHaveBeenCalledWith(cacheKey);

    mockPrism.apiKey.findUnique.mockResolvedValue(null);
    const validatedAfter = await getApiKeyByHash(hashedKey);
    expect(validatedAfter).toBeNull();
  });

  it("revokeApiKeyByHash flips isActive=false and invalidates Redis cache immediately", async () => {
    const hashedKey = "cafebabekey456";
    mockPrism.apiKey.update.mockResolvedValue({ id: "x" });

    const revoked = await revokeApiKeyByHash(hashedKey);
    expect(revoked).toBe(true);

    expect(mockPrism.apiKey.update).toHaveBeenCalledWith({
      where: { hashedKey },
      data: { isActive: false },
    });

    const cacheKey = `oa:apikey:${hashedKey}`;
    expect(redisInstance.del).toHaveBeenCalledWith(cacheKey);
  });

  it("revocation returns false when DB update throws (key not found)", async () => {
    mockPrism.apiKey.update.mockRejectedValue(new Error("not found"));
    const byId = await revokeApiKeyById("nonexistent");
    const byHash = await revokeApiKeyByHash("nohash");
    expect(byId).toBe(false);
    expect(byHash).toBe(false);
  });

  it("validateApiKey returns null for revoked key even if cached value existed", async () => {
    const { key: rawKey, hash: hashedKey } = generateApiKey();
    const activeRecord: ApiKey = {
      id: "cl_wasactive",
      prefix: "oa_live",
      keyHash: hashedKey,
      appId: "app",
      userId: "usr",
      tier: "free",
      isActive: true,
      createdAt: new Date(),
    };

    const store = (redisInstance as any).__store as Map<string, string>;
    store.set(
      `oa:apikey:${hashedKey}`,
      JSON.stringify({
        ...activeRecord,
        createdAt: activeRecord.createdAt.toISOString(),
        lastUsedAt: null,
      })
    );

    const beforeRevoke = await validateApiKey(rawKey);
    expect(beforeRevoke).not.toBeNull();
    expect(beforeRevoke?.isActive).toBe(true);

    mockPrism.apiKey.update.mockResolvedValue({ hashedKey });
    await revokeApiKeyById(activeRecord.id);
    expect(store.has(`oa:apikey:${hashedKey}`)).toBe(false);

    mockPrism.apiKey.findUnique.mockResolvedValue({
      id: activeRecord.id,
      hashedKey,
      appName: "app",
      owner: "usr",
      tier: "free",
      isActive: false,
      createdAt: activeRecord.createdAt,
      lastUsedAt: null,
    });

    const afterRevoke = await validateApiKey(rawKey);
    expect(afterRevoke).toBeNull();
  });

  it("validateApiKey caches valid lookups in Redis with ~300s TTL and avoids DB on 2nd hit", async () => {
    const { key: rawKey, hash: hashedKey } = generateApiKey();
    const now = new Date();
    const dbRow = {
      id: "cl_cachedemo",
      hashedKey,
      appName: "cache-app",
      owner: "owner-x",
      tier: "partner",
      isActive: true,
      createdAt: now,
      lastUsedAt: null,
    };

    mockPrism.apiKey.findUnique.mockResolvedValue(dbRow);

    const first = await validateApiKey(rawKey);
    expect(first).not.toBeNull();
    expect(first?.tier).toBe("partner");

    expect(mockPrism.apiKey.findUnique).toHaveBeenCalledTimes(1);
    expect(redisInstance.set).toHaveBeenCalledWith(
      `oa:apikey:${hashedKey}`,
      expect.any(String),
      "EX",
      300
    );

    const store = (redisInstance as any).__store;
    const cachedRaw = store.get(`oa:apikey:${hashedKey}`);
    expect(cachedRaw).toBeDefined();
    const cached = JSON.parse(cachedRaw);
    expect(cached.keyHash).toBe(hashedKey);
    expect(cached.isActive).toBe(true);

    mockPrism.apiKey.findUnique.mockClear();
    const second = await validateApiKey(rawKey);
    expect(second).not.toBeNull();
    expect(second?.id).toBe(dbRow.id);
    expect(mockPrism.apiKey.findUnique).toHaveBeenCalledTimes(0);
  });

  it("validateApiKey returns null for malformed keys without touching DB or cache", async () => {
    const result = await validateApiKey("not-a-valid-key");
    expect(result).toBeNull();
    expect(mockPrism.apiKey.findUnique).not.toHaveBeenCalled();
    expect(redisInstance.get).not.toHaveBeenCalled();
  });
});

describe("scripts/migrate-env-apikeys.ts - Migration Script", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parseEnvApiKeys correctly splits hashedKey:tier:appName entries including colons in appName", () => {
    const raw =
      "hashAAAA:free:my-simple-app,hashBBBB:partner:corp:app:with:colons,hashCCCC:bogustier:unknown";
    const entries = parseEnvApiKeys(raw);

    expect(entries).toHaveLength(3);

    expect(entries[0]).toEqual({
      hashedKey: "hashAAAA",
      tier: "free",
      appName: "my-simple-app",
    });

    expect(entries[1]).toEqual({
      hashedKey: "hashBBBB",
      tier: "partner",
      appName: "corp:app:with:colons",
    });

    expect(entries[2].tier).toBe("free");
    expect(entries[2].hashedKey).toBe("hashCCCC");
    expect(entries[2].appName).toBe("unknown");
  });

  it("parseEnvApiKeys handles empty strings and whitespace correctly", () => {
    expect(parseEnvApiKeys("")).toEqual([]);
    expect(parseEnvApiKeys("   ")).toEqual([]);
    expect(parseEnvApiKeys("  , , ")).toEqual([]);
  });

  it("parseEnvApiKeys throws on malformed entries missing fields", () => {
    expect(() => parseEnvApiKeys("hashonly:notier")).toThrow(/Invalid OA_API_KEYS entry/);
    expect(() => parseEnvApiKeys(":free:no-hash")).toThrow(/hashedKey is empty/);
  });

  it("upsertEnvApiKeys calls prisma upsert for each entry with correct data", async () => {
    const fakeDb: any = {
      apiKey: {
        upsert: vi.fn().mockResolvedValue({ id: "x" }),
      },
    };

    const entries = parseEnvApiKeys(
      "h1:free:app-one,h2:partner:app-two"
    );
    expect(entries).toHaveLength(2);

    const result = await upsertEnvApiKeys(entries, fakeDb);
    expect(result.upserted).toBe(2);
    expect(result.skipped).toBe(0);

    expect(fakeDb.apiKey.upsert).toHaveBeenCalledTimes(2);
    const [firstCall, secondCall] = fakeDb.apiKey.upsert.mock.calls;

    expect(firstCall[0].where).toEqual({ hashedKey: "h1" });
    expect(firstCall[0].create).toEqual({
      hashedKey: "h1",
      tier: "free",
      appName: "app-one",
      owner: "app-one",
      isActive: true,
    });
    expect(firstCall[0].update).toEqual({
      tier: "free",
      appName: "app-one",
      owner: "app-one",
      isActive: true,
    });

    expect(secondCall[0].where).toEqual({ hashedKey: "h2" });
    expect(secondCall[0].create.tier).toBe("partner");
    expect(secondCall[0].update.tier).toBe("partner");
  });

  it("upsertEnvApiKeys counts skipped on DB errors", async () => {
    const fakeDb: any = {
      apiKey: {
        upsert: vi
          .fn()
          .mockResolvedValueOnce({ id: "ok" })
          .mockRejectedValueOnce(new Error("boom")),
      },
    };

    const entries = parseEnvApiKeys("a:free:a,b:free:b");
    const result = await upsertEnvApiKeys(entries, fakeDb);
    expect(result.upserted).toBe(1);
    expect(result.skipped).toBe(1);
  });
});

describe("Mock Code Removal Verification", () => {
  it("MOCK_API_KEYS and initMockApiKeys do not exist in lib/api/apiKeys.ts source", () => {
    const filePath = path.resolve(
      __dirname,
      "..",
      "apiKeys.ts"
    );
    const source = fs.readFileSync(filePath, "utf8");

    expect(source).not.toContain("MOCK_API_KEYS");
    expect(source).not.toContain("initMockApiKeys");
    expect(source).not.toMatch(/new Map\(\)/);
  });

  it("imports of MOCK_API_KEYS / initMockApiKeys do not exist anywhere in the codebase", () => {
    const rootDir = path.resolve(__dirname, "..", "..", "..");
    const searchDirs = ["lib", "app", "pages", "components", "scripts", "prisma"];

    const collectFiles = (dir: string): string[] => {
      let out: string[] = [];
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return out;
      }
      for (const e of entries) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          out = out.concat(collectFiles(full));
        } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(e.name)) {
          out.push(full);
        }
      }
      return out;
    };

    const files: string[] = [];
    for (const d of searchDirs) {
      files.push(...collectFiles(path.join(rootDir, d)));
    }

    const offenders: string[] = [];
    for (const f of files) {
      const content = fs.readFileSync(f, "utf8");
      if (
        /\bMOCK_API_KEYS\b/.test(content) ||
        /\binitMockApiKeys\b/.test(content)
      ) {
        offenders.push(path.relative(rootDir, f));
      }
    }

    expect(offenders).toEqual([]);
  });

  it("lib/api/apiKeys.ts module exports contain no mock symbols", async () => {
    const mod = await import("../apiKeys");
    const exportedNames = Object.keys(mod);
    expect(exportedNames).not.toContain("MOCK_API_KEYS");
    expect(exportedNames).not.toContain("initMockApiKeys");
    expect(exportedNames).toContain("issueApiKey");
    expect(exportedNames).toContain("revokeApiKeyById");
    expect(exportedNames).toContain("revokeApiKeyByHash");
    expect(exportedNames).toContain("validateApiKey");
    expect(exportedNames).toContain("getApiKeyByHash");
  });
});
