import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const findMany = vi.fn();
const count = vi.fn();

vi.mock("@/lib/db/client", () => ({
  db: {
    event: {
      findMany: (args: any) => findMany(args),
      count: (args: any) => count(args),
    },
  },
}));

vi.mock("@/lib/api/middleware", () => ({
  authenticateAndRateLimit: vi.fn(() => Promise.resolve(null)),
}));

import { GET } from "./route";
import { authenticateAndRateLimit } from "@/lib/api/middleware";

type Row = {
  id: string;
  contractId: string;
  ledger: number;
  timestamp: number;
  txHash: string;
  topics: string[];
  data: string;
  description: string | null;
  status: string;
  blueprintName: string | null;
  eventType: string | null;
};

function makeRow(overrides: Partial<Row> & Pick<Row, "id" | "ledger">): Row {
  return {
    contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
    timestamp: 1_700_000_000,
    txHash: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
    topics: ["0x0000000000000000000000000000000000000000000000000000000074726e73"],
    data: "0x00",
    description: "Transferred 100 USDC",
    status: "translated",
    blueprintName: "Stellar Asset Contract (SAC)",
    eventType: "Transfer",
    ...overrides,
  };
}

/** Simulates the DB: filters, sorts, and paginates an in-memory table. */
function installTable(rows: Row[]) {
  function filtered(args: any): Row[] {
    let result = [...rows];
    const where = args.where ?? {};
    if (where.contractId) result = result.filter((r) => r.contractId === where.contractId);
    if (where.txHash) result = result.filter((r) => r.txHash === where.txHash);
    if (where.status) result = result.filter((r) => r.status === where.status);
    if (where.ledger) {
      if (where.ledger.gte !== undefined) result = result.filter((r) => r.ledger >= where.ledger.gte);
      if (where.ledger.lte !== undefined) result = result.filter((r) => r.ledger <= where.ledger.lte);
    }
    return result;
  }

  findMany.mockImplementation((args: any) => {
    let result = filtered(args);
    result.sort((a, b) => b.ledger - a.ledger || b.id.localeCompare(a.id));
    const skip = args.skip ?? 0;
    const take = args.take;
    result = result.slice(skip, take !== undefined ? skip + take : undefined);
    return Promise.resolve(result);
  });

  count.mockImplementation((args: any) => Promise.resolve(filtered(args).length));
}

function request(query: string): NextRequest {
  return new NextRequest(`http://localhost/api/v1/events${query}`);
}

beforeEach(() => {
  findMany.mockReset();
  count.mockReset();
  vi.mocked(authenticateAndRateLimit).mockReset();
  vi.mocked(authenticateAndRateLimit).mockResolvedValue(null);
});

describe("GET /api/v1/events", () => {
  it("returns a 401-shaped response when authentication fails", async () => {
    const { NextResponse } = await import("next/server");
    vi.mocked(authenticateAndRateLimit).mockResolvedValueOnce(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );

    const res = await GET(request(""));

    expect(res.status).toBe(401);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("returns the first page of events with pagination metadata", async () => {
    installTable([
      makeRow({ id: "e-1", ledger: 100 }),
      makeRow({ id: "e-2", ledger: 101 }),
      makeRow({ id: "e-3", ledger: 102 }),
    ]);

    const res = await GET(request("?limit=2"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.events).toHaveLength(2);
    expect(body.events[0].ledger).toBe(102); // ledger desc
    expect(body.pagination).toEqual({ page: 1, limit: 2, total: 3, hasMore: true });
  });

  it("returns the second page and reports no more pages once exhausted", async () => {
    installTable([
      makeRow({ id: "e-1", ledger: 100 }),
      makeRow({ id: "e-2", ledger: 101 }),
      makeRow({ id: "e-3", ledger: 102 }),
    ]);

    const res = await GET(request("?limit=2&page=2"));
    const body = await res.json();

    expect(body.events).toHaveLength(1);
    expect(body.pagination).toEqual({ page: 2, limit: 2, total: 3, hasMore: false });
  });

  it("filters by contractId, txHash, status, and ledger range", async () => {
    installTable([
      makeRow({ id: "e-1", ledger: 100, contractId: "CONTRACT_A", status: "translated" }),
      makeRow({ id: "e-2", ledger: 200, contractId: "CONTRACT_B", status: "translated" }),
      makeRow({ id: "e-3", ledger: 300, contractId: "CONTRACT_A", status: "cryptic" }),
    ]);

    const res = await GET(
      request("?contractId=CONTRACT_A&status=translated&startLedger=50&endLedger=250")
    );
    const body = await res.json();

    expect(body.events).toHaveLength(1);
    expect(body.events[0].id).toBe("e-1");
  });

  it("rejects a non-positive page", async () => {
    const res = await GET(request("?page=0"));
    expect(res.status).toBe(400);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("rejects a limit above the maximum", async () => {
    const res = await GET(request("?limit=101"));
    expect(res.status).toBe(400);
  });

  it("rejects an invalid status value", async () => {
    const res = await GET(request("?status=bogus"));
    expect(res.status).toBe(400);
  });

  it("returns 422 when startLedger exceeds endLedger", async () => {
    const res = await GET(request("?startLedger=100&endLedger=50"));
    expect(res.status).toBe(422);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("returns an empty page with correct pagination when no events match", async () => {
    installTable([]);

    const res = await GET(request(""));
    const body = await res.json();

    expect(body.events).toEqual([]);
    expect(body.pagination).toEqual({ page: 1, limit: 25, total: 0, hasMore: false });
  });
});
