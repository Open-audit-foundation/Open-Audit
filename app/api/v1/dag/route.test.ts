import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/api/middleware", () => ({
  authenticateAndRateLimit: vi.fn(() => Promise.resolve(null)),
}));

const mockGetByTxHash = vi.fn();
const mockGetById = vi.fn();
const mockGetByLedger = vi.fn();
const mockListReentrancy = vi.fn();

vi.mock("@/lib/dag/persistence", () => ({
  getExecutionDagByTxHash: (...args: any[]) => mockGetByTxHash(...args),
  getExecutionDagById: (...args: any[]) => mockGetById(...args),
  getExecutionDagByLedger: (...args: any[]) => mockGetByLedger(...args),
  listReentrancyDags: (...args: any[]) => mockListReentrancy(...args),
}));

import { GET } from "./route";

const mockDag = {
  txHash: "abc123def456",
  ledger: 100,
  timestamp: 1700000000,
  nodes: [{ id: 0, kind: "contract_fn", contractId: "CABC...", depth: 0, children: [] }],
  maxDepth: 0,
  uniqueContracts: 1,
  hasReentrancy: false,
  reentrancyDetails: [],
  authTraces: [],
};

function makeRequest(params: Record<string, string>): NextRequest {
  const qs = new URLSearchParams(params).toString();
  return new NextRequest(`http://localhost/api/v1/dag?${qs}`, {
    headers: { authorization: "Bearer test-api-key-12345678901234567890" },
  });
}

describe("GET /api/v1/dag", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when no query param is provided", async () => {
    const req = makeRequest({});
    const res = await GET(req);
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBeDefined();
  });

  it("fetches DAG by txHash", async () => {
    mockGetByTxHash.mockResolvedValueOnce(mockDag);

    const req = makeRequest({ txHash: "abc123def456" });
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.dag).toBeDefined();
    expect(body.dag.txHash).toBe("abc123def456");
    expect(mockGetByTxHash).toHaveBeenCalledWith("abc123def456");
  });

  it("returns 404 when txHash not found", async () => {
    mockGetByTxHash.mockResolvedValueOnce(null);

    const req = makeRequest({ txHash: "nonexistent" });
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toContain("not found");
  });

  it("fetches DAG by id", async () => {
    mockGetById.mockResolvedValueOnce(mockDag);

    const req = makeRequest({ id: "dag-1" });
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.dag).toBeDefined();
    expect(mockGetById).toHaveBeenCalledWith("dag-1");
  });

  it("returns 404 when id not found", async () => {
    mockGetById.mockResolvedValueOnce(null);

    const req = makeRequest({ id: "nonexistent" });
    const res = await GET(req);
    expect(res.status).toBe(404);
  });

  it("fetches DAG by ledger", async () => {
    mockGetByLedger.mockResolvedValueOnce(mockDag);

    const req = makeRequest({ ledger: "100" });
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.dag).toBeDefined();
    expect(mockGetByLedger).toHaveBeenCalledWith(100);
  });

  it("rejects invalid ledger values", async () => {
    const req = makeRequest({ ledger: "abc" });
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("lists reentrancy-flagged DAGs when reentrancy=true", async () => {
    mockListReentrancy.mockResolvedValueOnce([
      { ...mockDag, hasReentrancy: true },
    ]);

    const req = makeRequest({ reentrancy: "true" });
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.dags).toBeDefined();
    expect(body.dags.length).toBe(1);
    expect(body.dags[0].hasReentrancy).toBe(true);
    expect(mockListReentrancy).toHaveBeenCalledWith(50);
  });

  it("returns 500 on unexpected errors", async () => {
    mockGetByTxHash.mockRejectedValueOnce(new Error("DB connection failed"));

    const req = makeRequest({ txHash: "abc" });
    const res = await GET(req);
    expect(res.status).toBe(500);
  });
});
