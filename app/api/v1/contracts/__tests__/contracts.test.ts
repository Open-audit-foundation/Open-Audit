import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Mock Prisma client ───────────────────────────────────────────────────────
const groupBy = vi.fn();

vi.mock("@/lib/db/client", () => ({
  db: {
    event: {
      groupBy: (args: any) => groupBy(args),
    },
  },
}));

// ── Mock Redis cache ─────────────────────────────────────────────────────────
const cacheStore = new Map<string, string>();

vi.mock("@/lib/cache/redisCache", () => ({
  isRedisEnabled: () => true,
  getCached: async <T,>(key: string): Promise<T | null> => {
    const raw = cacheStore.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  },
  setCached: async (key: string, value: unknown, ttlSeconds?: number) => {
    cacheStore.set(key, JSON.stringify(value));
  },
}));

// ── Imports under test ───────────────────────────────────────────────────────
import { GET as getContractsList } from "../route";
import { GET as getContractDetail } from "../[contractId]/route";

// ── Helpers ──────────────────────────────────────────────────────────────────

function request(path: string): NextRequest {
  return new NextRequest(`http://localhost${path}`);
}

/** The first SAC contract ID from the real blueprint registry. */
const SAC_CONTRACT_ID =
  "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

beforeEach(() => {
  groupBy.mockReset();
  cacheStore.clear();
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/v1/contracts
// ══════════════════════════════════════════════════════════════════════════════

describe("GET /api/v1/contracts", () => {
  it("returns a list of all registered contracts with metadata", async () => {
    const res = await getContractsList();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveProperty("contracts");
    expect(body).toHaveProperty("total");
    expect(Array.isArray(body.contracts)).toBe(true);
    expect(body.total).toBe(body.contracts.length);
    expect(body.total).toBeGreaterThan(0);
  });

  it("each contract entry has the required metadata fields", async () => {
    const res = await getContractsList();
    const body = await res.json();

    for (const contract of body.contracts) {
      expect(contract).toHaveProperty("contractId");
      expect(contract).toHaveProperty("contractName");
      expect(contract).toHaveProperty("schemaCount");
      expect(contract).toHaveProperty("latestVersion");

      expect(typeof contract.contractId).toBe("string");
      expect(typeof contract.contractName).toBe("string");
      expect(typeof contract.schemaCount).toBe("number");
      expect(typeof contract.latestVersion).toBe("string");

      expect(contract.schemaCount).toBeGreaterThan(0);
      // Stellar contract IDs always start with "C"
      expect(contract.contractId.startsWith("C")).toBe(true);
    }
  });

  it("includes the SAC contract known to be registered", async () => {
    const res = await getContractsList();
    const body = await res.json();

    const sac = body.contracts.find(
      (c: any) => c.contractId === SAC_CONTRACT_ID
    );
    expect(sac).toBeDefined();
    expect(sac.contractName).toContain("Stellar Asset Contract");
  });

  it("contracts list does not expose internal blueprint function references", async () => {
    const res = await getContractsList();
    const body = await res.json();

    for (const contract of body.contracts) {
      // Must not leak internal function references
      expect(contract.blueprint).toBeUndefined();
      expect(contract.translate).toBeUndefined();
      expect(contract.matches).toBeUndefined();
      expect(typeof contract).not.toBe("function");
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/v1/contracts/[contractId]
// ══════════════════════════════════════════════════════════════════════════════

describe("GET /api/v1/contracts/[contractId]", () => {
  it("returns metadata and coverage stats for a registered contract", async () => {
    groupBy.mockResolvedValue([
      { status: "translated", _count: { status: 150 } },
      { status: "cryptic", _count: { status: 50 } },
    ]);

    const res = await getContractDetail(request("/ignored"), {
      params: { contractId: SAC_CONTRACT_ID },
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.supported).toBe(true);
    expect(body.contract).toBeDefined();
    expect(body.contract.contractId).toBe(SAC_CONTRACT_ID);
    expect(body.contract.contractName).toContain("Stellar Asset Contract");
    expect(body.contract.schemaCount).toBeGreaterThan(0);

    expect(body.coverage).toBeDefined();
    expect(body.coverage.totalEvents).toBe(200);
    expect(body.coverage.translatedCount).toBe(150);
    expect(body.coverage.crypticCount).toBe(50);
    expect(body.coverage.translationRate).toBe(0.75);
  });

  it("returns zeroed coverage stats when no events exist for the contract", async () => {
    groupBy.mockResolvedValue([]);

    const res = await getContractDetail(request("/ignored"), {
      params: { contractId: SAC_CONTRACT_ID },
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.supported).toBe(true);
    expect(body.coverage.totalEvents).toBe(0);
    expect(body.coverage.translatedCount).toBe(0);
    expect(body.coverage.crypticCount).toBe(0);
    expect(body.coverage.translationRate).toBe(0);
  });

  it("returns a structured not-supported response for unregistered contracts", async () => {
    const unknownId = "CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";

    const res = await getContractDetail(request("/ignored"), {
      params: { contractId: unknownId },
    });
    const body = await res.json();

    // Must NOT be a 404 — structured 200 response
    expect(res.status).toBe(200);
    expect(body.supported).toBe(false);
    expect(body.contractId).toBe(unknownId);
    expect(body.message).toBeDefined();
    expect(typeof body.message).toBe("string");
    expect(body.message).toContain("not registered");

    // Must not have leaked coverage or contract metadata
    expect(body.contract).toBeUndefined();
    expect(body.coverage).toBeUndefined();

    // Prisma should never be queried for unregistered contracts
    expect(groupBy).not.toHaveBeenCalled();
  });

  it("only translated and cryptic statuses are counted correctly", async () => {
    groupBy.mockResolvedValue([
      { status: "translated", _count: { status: 80 } },
      { status: "cryptic", _count: { status: 20 } },
    ]);

    const res = await getContractDetail(request("/ignored"), {
      params: { contractId: SAC_CONTRACT_ID },
    });
    const body = await res.json();

    expect(body.coverage.totalEvents).toBe(100);
    expect(body.coverage.translatedCount).toBe(80);
    expect(body.coverage.crypticCount).toBe(20);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Redis caching behaviour
// ══════════════════════════════════════════════════════════════════════════════

describe("Redis caching for contract coverage stats", () => {
  it("caches coverage stats so Prisma is only queried once", async () => {
    groupBy.mockResolvedValue([
      { status: "translated", _count: { status: 42 } },
    ]);

    // First call — should hit Prisma
    await getContractDetail(request("/ignored"), {
      params: { contractId: SAC_CONTRACT_ID },
    });
    expect(groupBy).toHaveBeenCalledTimes(1);

    // Second call — should hit the Redis cache (no additional Prisma query)
    await getContractDetail(request("/ignored"), {
      params: { contractId: SAC_CONTRACT_ID },
    });
    expect(groupBy).toHaveBeenCalledTimes(1); // still 1!
  });

  it("returns the same values from cache as from the original query", async () => {
    groupBy.mockResolvedValue([
      { status: "translated", _count: { status: 99 } },
      { status: "cryptic", _count: { status: 11 } },
    ]);

    const res1 = await getContractDetail(request("/ignored"), {
      params: { contractId: SAC_CONTRACT_ID },
    });
    const body1 = await res1.json();

    // Clear the groupBy mock so we can confirm the second call is cached.
    groupBy.mockClear();

    const res2 = await getContractDetail(request("/ignored"), {
      params: { contractId: SAC_CONTRACT_ID },
    });
    const body2 = await res2.json();

    expect(groupBy).not.toHaveBeenCalled();
    expect(body1.coverage).toEqual(body2.coverage);
    expect(body2.coverage.totalEvents).toBe(110);
  });

  it("uses separate cache keys for different contracts", async () => {
    const SECOND_CONTRACT = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";

    groupBy.mockResolvedValueOnce([
      { status: "translated", _count: { status: 10 } },
    ]);
    groupBy.mockResolvedValueOnce([
      { status: "cryptic", _count: { status: 5 } },
    ]);

    await getContractDetail(request("/ignored"), {
      params: { contractId: SAC_CONTRACT_ID },
    });
    await getContractDetail(request("/ignored"), {
      params: { contractId: SECOND_CONTRACT },
    });

    // Both should have hit Prisma (different cache keys)
    expect(groupBy).toHaveBeenCalledTimes(2);

    // Query again — both should now be cached
    groupBy.mockClear();
    await getContractDetail(request("/ignored"), {
      params: { contractId: SAC_CONTRACT_ID },
    });
    await getContractDetail(request("/ignored"), {
      params: { contractId: SECOND_CONTRACT },
    });
    expect(groupBy).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Not-supported response shape
// ══════════════════════════════════════════════════════════════════════════════

describe("not-supported response shape", () => {
  it("has a stable, documented shape for integrators", async () => {
    const unknownId = "CUNKNOWN_CONTRACT_1234567890123456789012345678901234567";

    const res = await getContractDetail(request("/ignored"), {
      params: { contractId: unknownId },
    });
    const body = await res.json();

    // The response should have exactly these top-level keys
    const keys = Object.keys(body).sort();
    expect(keys).toEqual(["contractId", "message", "supported"]);

    expect(body.supported).toBe(false);
    expect(body.contractId).toBe(unknownId);
    expect(body.message).toBeTypeOf("string");
  });

  it("returns 200 (not 404) so tooling can rely on the JSON shape", async () => {
    const unknownId = "CUNKNOWN_CONTRACT_1234567890123456789012345678901234567";
    const res = await getContractDetail(request("/ignored"), {
      params: { contractId: unknownId },
    });
    expect(res.status).toBe(200);
  });
});
