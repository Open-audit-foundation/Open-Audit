import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Mock the Prisma client ───────────────────────────────────────────────────
// A tiny in-memory stand-in for db.event.findMany that honours the subset of
// query options the export route relies on: where (contractId + ledger range),
// ascending (ledger, id) ordering, take, and keyset cursor + skip pagination.
const findMany = vi.fn();

vi.mock("@/lib/db/client", () => ({
  db: {
    event: {
      findMany: (args: any) => findMany(args),
    },
  },
}));

import { GET } from "./route";

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

/** Simulates the DB: filters, sorts and paginates an in-memory table. */
function installTable(rows: Row[]) {
  findMany.mockImplementation((args: any) => {
    let result = [...rows];

    const where = args.where ?? {};
    if (where.contractId) {
      result = result.filter((r) => r.contractId === where.contractId);
    }
    if (where.ledger) {
      if (where.ledger.gte !== undefined) result = result.filter((r) => r.ledger >= where.ledger.gte);
      if (where.ledger.lte !== undefined) result = result.filter((r) => r.ledger <= where.ledger.lte);
    }

    result.sort((a, b) => (a.ledger - b.ledger) || a.id.localeCompare(b.id));

    if (args.cursor?.id) {
      const idx = result.findIndex((r) => r.id === args.cursor.id);
      const skip = args.skip ?? 0;
      result = idx === -1 ? [] : result.slice(idx + skip);
    }

    if (args.take !== undefined) {
      result = result.slice(0, args.take);
    }

    // Respect `select` loosely — return whole rows, the route only reads known cols.
    return Promise.resolve(result);
  });
}

function request(query: string): NextRequest {
  return new NextRequest(`http://localhost/api/v1/events/export${query}`);
}

beforeEach(() => {
  findMany.mockReset();
});

describe("GET /api/v1/events/export", () => {
  it("streams CSV rows sourced from the database", async () => {
    installTable([
      makeRow({ id: "e-1", ledger: 100 }),
      makeRow({ id: "e-2", ledger: 101, eventType: "Mint", description: "Minted 5 USDC" }),
    ]);

    const res = await GET(request("?format=csv"));
    const text = await res.text();
    const lines = text.trim().split("\r\n");

    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(lines[0]).toBe(
      "timestamp,ledger_id,contract_id,tx_hash,event_name,status,plain_english_translation,proof_url"
    );
    expect(lines).toHaveLength(3); // header + 2 rows
    expect(lines[1]).toContain("Transfer");
    expect(lines[1]).toContain("Transferred 100 USDC");
    expect(lines[2]).toContain("Mint");
    // The route must never fall back to fabricated mock data.
    expect(findMany).toHaveBeenCalled();
  });

  it("emits a valid JSON array", async () => {
    installTable([
      makeRow({ id: "e-1", ledger: 100 }),
      makeRow({ id: "e-2", ledger: 101 }),
    ]);

    const res = await GET(request("?format=json"));
    const parsed = JSON.parse(await res.text());

    expect(res.headers.get("Content-Type")).toContain("application/json");
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].ledger_id).toBe(100);
  });

  it("emits newline-delimited JSON", async () => {
    installTable([makeRow({ id: "e-1", ledger: 100 })]);

    const res = await GET(request("?format=ndjson"));
    const text = await res.text();
    const lines = text.trim().split("\n").filter(Boolean);

    expect(res.headers.get("Content-Type")).toContain("application/x-ndjson");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).ledger_id).toBe(100);
  });

  it("produces an empty-but-valid JSON array when no events match", async () => {
    installTable([]);

    const res = await GET(request("?format=json"));
    const parsed = JSON.parse(await res.text());

    expect(parsed).toEqual([]);
  });

  it("passes contractId and ledger-range filters through to the query", async () => {
    installTable([
      makeRow({ id: "e-1", ledger: 100, contractId: "CONTRACT_A" }),
      makeRow({ id: "e-2", ledger: 200, contractId: "CONTRACT_B" }),
      makeRow({ id: "e-3", ledger: 300, contractId: "CONTRACT_A" }),
    ]);

    const res = await GET(
      request("?format=ndjson&contractId=CONTRACT_A&startLedger=150&endLedger=400")
    );
    const lines = (await res.text()).trim().split("\n").filter(Boolean);

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).ledger_id).toBe(300);

    const passedWhere = findMany.mock.calls[0][0].where;
    expect(passedWhere.contractId).toBe("CONTRACT_A");
    expect(passedWhere.ledger).toEqual({ gte: 150, lte: 400 });
  });

  it("cursors through pages larger than the chunk size and respects limit", async () => {
    // 1200 rows > CHUNK_SIZE (500) forces multiple keyset pages.
    const rows = Array.from({ length: 1200 }, (_, i) =>
      makeRow({ id: `e-${String(i).padStart(5, "0")}`, ledger: 1000 + i })
    );
    installTable(rows);

    const res = await GET(request("?format=ndjson&limit=1000"));
    const lines = (await res.text()).trim().split("\n").filter(Boolean);

    expect(lines).toHaveLength(1000); // limit enforced
    expect(findMany.mock.calls.length).toBeGreaterThan(1); // paginated

    // Every page after the first must use a cursor + skip.
    for (let i = 1; i < findMany.mock.calls.length; i++) {
      expect(findMany.mock.calls[i][0].cursor).toBeDefined();
      expect(findMany.mock.calls[i][0].skip).toBe(1);
    }
  });

  it("rejects an invalid format", async () => {
    const res = await GET(request("?format=xml"));
    expect(res.status).toBe(400);
    expect(findMany).not.toHaveBeenCalled();
  });
});
