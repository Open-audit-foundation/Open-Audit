import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const findMany = vi.fn();
const queryRaw = vi.fn();

vi.mock("@/lib/db/client", () => ({
  db: {
    event: {
      findMany: (args: unknown) => findMany(args),
    },
    $queryRaw: (sql: unknown) => queryRaw(sql),
  },
}));

/** Recursively collects bind values from a Prisma.sql fragment tree. */
function collectValues(node: unknown): unknown[] {
  if (
    node !== null &&
    typeof node === "object" &&
    Array.isArray((node as { strings?: unknown }).strings) &&
    Array.isArray((node as { values?: unknown }).values)
  ) {
    return ((node as { values: unknown[] }).values).flatMap((v) => collectValues(v));
  }
  return [node];
}

vi.mock("@/lib/api/middleware", () => ({
  authenticateAndRateLimit: vi.fn(() => Promise.resolve(null)),
}));

import { POST } from "./route";
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
  schemaVersion: string | null;
};

function makeRow(overrides: Partial<Row> & Pick<Row, "id" | "ledger">): Row {
  return {
    contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
    timestamp: 1_700_000_000,
    txHash: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
    topics: ["0x74726e73"],
    data: "0x00",
    description: "Transferred 100 USDC",
    status: "translated",
    blueprintName: "Stellar Asset Contract (SAC)",
    eventType: "Transfer",
    schemaVersion: "1.0.0",
    ...overrides,
  };
}

function installTable(rows: Row[]) {
  findMany.mockImplementation(
    (args: { where?: unknown; take?: number; skip?: number; cursor?: { id: string } }) => {
      let result = [...rows];
      const where = (args.where ?? {}) as {
        AND?: Array<Record<string, unknown>>;
      };
      for (const clause of where.AND ?? []) {
        if (clause.contractId !== undefined) result = result.filter((r) => r.contractId === clause.contractId);
        if (clause.eventType !== undefined) result = result.filter((r) => r.eventType === clause.eventType);
        if (clause.status !== undefined) result = result.filter((r) => r.status === clause.status);
        const ledger = clause.ledger as { gte?: number; lte?: number } | undefined;
        if (ledger) {
          if (ledger.gte !== undefined) result = result.filter((r) => r.ledger >= ledger.gte!);
          if (ledger.lte !== undefined) result = result.filter((r) => r.ledger <= ledger.lte!);
        }
      }
      result.sort((a, b) => b.ledger - a.ledger || b.id.localeCompare(a.id));
      let start = 0;
      if (args.cursor) {
        // Prisma cursor semantics: resume strictly after the cursor row.
        const idx = result.findIndex((r) => r.id === args.cursor!.id);
        start = idx === -1 ? 0 : idx + (args.skip ?? 0);
      } else if (args.skip) {
        start = args.skip;
      }
      const take = args.take;
      result = result.slice(start, take !== undefined ? start + take : undefined);
      return Promise.resolve(result);
    }
  );
}

function post(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v1/events/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authenticateAndRateLimit).mockResolvedValue(null);
});

describe("validation", () => {
  it("rejects invalid JSON", async () => {
    const req = new NextRequest("http://localhost/api/v1/events/search", {
      method: "POST",
      body: "{not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("rejects limit < 1", async () => {
    const res = await POST(post({ limit: 0 }));
    expect(res.status).toBe(400);
  });

  it("rejects negative startLedger", async () => {
    const res = await POST(post({ startLedger: -5 }));
    expect(res.status).toBe(400);
  });

  it("rejects negative endLedger", async () => {
    const res = await POST(post({ endLedger: -1 }));
    expect(res.status).toBe(400);
  });

  it("rejects startLedger > endLedger", async () => {
    const res = await POST(post({ startLedger: 10, endLedger: 5 }));
    expect(res.status).toBe(400);
  });

  it("rejects invalid status", async () => {
    const res = await POST(post({ status: "bogus" }));
    expect(res.status).toBe(400);
  });

  it("propagates auth failures", async () => {
    vi.mocked(authenticateAndRateLimit).mockResolvedValue(
      new (await import("next/server")).NextResponse("rate limited", { status: 429 })
    );
    const res = await POST(post({}));
    expect(res.status).toBe(429);
  });
});

describe("filter path (no text query) — regression coverage", () => {
  const rows = [
    makeRow({ id: "e3", ledger: 300, description: "Minted 5 XLM", eventType: "Mint", status: "translated" }),
    makeRow({ id: "e2", ledger: 200, description: "Transferred 100 USDC", eventType: "Transfer", status: "translated" }),
    makeRow({ id: "e1", ledger: 100, description: null, eventType: "Burn", status: "cryptic" }),
  ];

  it("returns all events ledger-desc when unfiltered", async () => {
    installTable(rows);
    const res = await POST(post({}));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.events.map((e: Row) => e.id)).toEqual(["e3", "e2", "e1"]);
    expect(json.pagination).toEqual({ nextCursor: null, hasMore: false, limit: 50 });
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it("applies contractId, eventType, status and ledger-range filters", async () => {
    installTable(rows);
    const res = await POST(
      post({
        contractId: rows[0].contractId,
        eventType: "Transfer",
        status: "translated",
        startLedger: 150,
        endLedger: 250,
      })
    );
    const json = await res.json();
    expect(json.events.map((e: Row) => e.id)).toEqual(["e2"]);
    // Verify the Prisma where clause was built as before (no FTS path taken).
    const args = findMany.mock.calls[0][0] as { where: { AND: unknown[] } };
    expect(args.where.AND).toHaveLength(4);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it("paginates with id cursors", async () => {
    installTable(rows);
    const first = await (await POST(post({ limit: 2 }))).json();
    expect(first.events.map((e: Row) => e.id)).toEqual(["e3", "e2"]);
    expect(first.pagination).toEqual({ nextCursor: "e2", hasMore: true, limit: 2 });

    const second = await (await POST(post({ limit: 2, cursor: first.pagination.nextCursor }))).json();
    expect(second.events.map((e: Row) => e.id)).toEqual(["e1"]);
    expect(second.pagination).toEqual({ nextCursor: null, hasMore: false, limit: 2 });

    // Cursor translates to Prisma cursor + skip=1 exactly as before.
    const args = findMany.mock.calls[1][0] as { cursor: { id: string }; skip: number };
    expect(args.cursor).toEqual({ id: "e2" });
    expect(args.skip).toBe(1);
  });

  it("caps limit at 200", async () => {
    installTable(rows);
    const res = await POST(post({ limit: 5000 }));
    const json = await res.json();
    expect(json.pagination.limit).toBe(200);
  });

  it("treats whitespace-only query as no text query", async () => {
    installTable(rows);
    const res = await POST(post({ query: "   " }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(queryRaw).not.toHaveBeenCalled();
    expect(json.events).toHaveLength(3);
  });
});

describe("full-text search path", () => {
  const ftsRows = [
    makeRow({ id: "f1", ledger: 500, description: "Transferred 100 USDC to savings" }),
    makeRow({ id: "f2", ledger: 400, description: "Minted 5 XLM" }),
  ];

  it("uses $queryRaw instead of findMany and returns ranked results", async () => {
    queryRaw.mockResolvedValue(ftsRows);
    const res = await POST(post({ query: "transferred usdc" }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(findMany).not.toHaveBeenCalled();
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(json.events.map((e: Row) => e.id)).toEqual(["f1", "f2"]);
    expect(json.pagination).toEqual({ nextCursor: null, hasMore: false, limit: 50 });
  });

  it("passes the query and filters as bound parameters (never interpolated)", async () => {
    queryRaw.mockResolvedValue([]);
    await POST(
      post({
        query: "transfer'; DROP TABLE \"Event\";--",
        contractId: "CXCONTRACT",
        eventType: "Transfer",
        status: "translated",
        startLedger: 10,
        endLedger: 20,
      })
    );
    const values = collectValues(queryRaw.mock.calls[0][0]);
    expect(values).toContain("transfer'; DROP TABLE \"Event\";--");
    expect(values).toContain("CXCONTRACT");
    expect(values).toContain("Transfer");
    expect(values).toContain("translated");
    expect(values).toContain(10);
    expect(values).toContain(20);
  });

  it("passes cursor through and reports hasMore from limit+1 fetch", async () => {
    queryRaw.mockResolvedValue([ftsRows[0], ftsRows[1], makeRow({ id: "f3", ledger: 300 })]);
    const res = await POST(post({ query: "usdc", limit: 2 }));
    const json = await res.json();
    expect(json.events.map((e: Row) => e.id)).toEqual(["f1", "f2"]);
    expect(json.pagination).toEqual({ nextCursor: "f2", hasMore: true, limit: 2 });
    const values = collectValues(queryRaw.mock.calls[0][0]);
    expect(values).toContain(null); // first page: cursor bind is null
    expect(values).toContain(3); // take = limit + 1
  });

  it("returns empty result set cleanly", async () => {
    queryRaw.mockResolvedValue([]);
    const res = await POST(post({ query: "zzz-no-match" }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.events).toEqual([]);
    expect(json.pagination).toEqual({ nextCursor: null, hasMore: false, limit: 50 });
  });
});
