import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ExportDataDialog } from "@/components/dashboard/ExportDataDialog";
import type { TranslatedEvent } from "@/lib/translator/types";

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
  schemaVersion: string | null;
  parserProvenance: string | null;
  sandboxError: string | null;
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
    schemaVersion: "1.0.0",
    parserProvenance: null,
    sandboxError: null,
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
      if (where.ledger.gte !== undefined)
        result = result.filter((r) => r.ledger >= where.ledger.gte);
      if (where.ledger.lte !== undefined)
        result = result.filter((r) => r.ledger <= where.ledger.lte);
    }

    result.sort((a, b) => a.ledger - b.ledger || a.id.localeCompare(b.id));

    if (args.cursor?.id) {
      const idx = result.findIndex((r) => r.id === args.cursor.id);
      const skip = args.skip ?? 0;
      result = idx === -1 ? [] : result.slice(idx + skip);
    }

    if (args.take !== undefined) {
      result = result.slice(0, args.take);
    }

    // Return only selected columns, as Prisma does, so omitted metadata cannot
    // leak into an export through the in-memory table.
    return Promise.resolve(
      args.select
        ? result.map((row) =>
            Object.fromEntries(Object.entries(row).filter(([key]) => args.select[key]))
          )
        : result
    );
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
      makeRow({
        id: "e-2",
        ledger: 101,
        eventType: "Mint",
        description: "Minted 5 USDC",
        schemaVersion: "2.0.0",
      }),
    ]);

    const res = await GET(request("?format=csv"));
    const text = await res.text();
    const lines = text.trim().split("\r\n");

    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(lines[0]).toBe(
      "timestamp,ledger_id,contract_id,tx_hash,event_name,status,plain_english_translation,proof_url,schema_version,parser_provenance,sandbox_error"
    );
    expect(lines).toHaveLength(3); // header + 2 rows
    expect(lines[1]).toContain("Transfer");
    expect(lines[1]).toContain("Transferred 100 USDC");
    expect(lines[1]).toContain("1.0.0");
    expect(lines[2]).toContain("Mint");
    expect(lines[2]).toContain("2.0.0");
    // The route must never fall back to fabricated mock data.
    expect(findMany).toHaveBeenCalled();
  });

  it("includes schema_version in JSON and NDJSON exports", async () => {
    installTable([
      makeRow({ id: "e-1", ledger: 100, schemaVersion: "1.0.0" }),
      makeRow({ id: "e-2", ledger: 101, schemaVersion: null }),
    ]);

    const jsonRes = await GET(request("?format=json"));
    const parsed = JSON.parse(await jsonRes.text());
    expect(parsed[0].schema_version).toBe("1.0.0");
    expect(parsed[1].schema_version).toBe("");

    const ndjsonRes = await GET(request("?format=ndjson"));
    const lines = (await ndjsonRes.text()).trim().split("\n").filter(Boolean);
    expect(JSON.parse(lines[0]).schema_version).toBe("1.0.0");
    expect(JSON.parse(lines[1]).schema_version).toBe("");
  });

  it.each(["csv", "json", "ndjson"] as const)(
    "preserves stored parser provenance and failures in %s exports",
    async (format) => {
      installTable([
        makeRow({ id: "community-success", ledger: 100, parserProvenance: "community-wasm" }),
        makeRow({
          id: "community-failure",
          ledger: 101,
          status: "cryptic",
          description: null,
          eventType: null,
          parserProvenance: "community-wasm",
          sandboxError: "TIMEOUT",
        }),
        makeRow({ id: "native", ledger: 102, parserProvenance: "native" }),
        makeRow({ id: "legacy", ledger: 103 }),
      ]);

      const response = await GET(request(`?format=${format}`));
      const text = await response.text();

      if (format === "csv") {
        const [header, ...rows] = text.trimEnd().split("\r\n");
        expect(header.split(",").slice(-2)).toEqual(["parser_provenance", "sandbox_error"]);
        expect(rows.map((row) => row.split(",").slice(-2))).toEqual([
          ["community-wasm", ""],
          ["community-wasm", "TIMEOUT"],
          ["native", ""],
          ["", ""],
        ]);
      } else {
        const rows =
          format === "json"
            ? JSON.parse(text)
            : text
                .trim()
                .split("\n")
                .map((line) => JSON.parse(line));
        expect(rows).toEqual([
          expect.objectContaining({ parser_provenance: "community-wasm", sandbox_error: null }),
          expect.objectContaining({
            parser_provenance: "community-wasm",
            sandbox_error: "TIMEOUT",
            status: "cryptic",
            plain_english_translation: "No translation available",
          }),
          expect.objectContaining({ parser_provenance: "native", sandbox_error: null }),
          expect.objectContaining({ parser_provenance: null, sandbox_error: null }),
        ]);
      }
    }
  );

  it("emits a valid JSON array", async () => {
    installTable([makeRow({ id: "e-1", ledger: 100 }), makeRow({ id: "e-2", ledger: 101 })]);

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

describe("ExportDataDialog downloads", () => {
  let downloads: Blob[];
  let links: string[];

  beforeEach(() => {
    downloads = [];
    links = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      if (!(blob instanceof Blob)) throw new Error("Expected an export Blob");
      downloads.push(blob);
      return "blob:open-audit-export";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      links.push(this.href);
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function communityEvent(): TranslatedEvent {
    return {
      raw: makeRow({ id: "community-browser", ledger: 100 }),
      description: "Stored community translation",
      status: "translated",
      blueprintName: "Community contract",
      eventType: "Transfer",
      schemaVersion: "community-v1",
      parserProvenance: "community-wasm",
    };
  }

  it.each(["csv", "json", "ndjson"] as const)(
    "keeps provenance and sandbox failures in a small %s download",
    async (format) => {
      const event = communityEvent();
      const events: TranslatedEvent[] = [
        event,
        { ...event, status: "cryptic", description: null, sandboxError: "TIMEOUT" },
        { ...event, parserProvenance: "native" },
        { ...event, parserProvenance: undefined },
      ];
      render(
        createElement(ExportDataDialog, {
          open: true,
          onOpenChange: vi.fn(),
          events,
        })
      );

      fireEvent.click(screen.getByRole("button", { name: `Export as ${format.toUpperCase()}` }));
      fireEvent.click(screen.getByRole("button", { name: `Download ${format.toUpperCase()}` }));

      expect(downloads).toHaveLength(1);
      expect(links).toEqual(["blob:open-audit-export"]);
      const text = await downloads[0].text();
      if (format === "csv") {
        const [header, ...rows] = text.split("\r\n");
        expect(header.split(",").slice(-2)).toEqual(["parser_provenance", "sandbox_error"]);
        expect(rows.map((row) => row.split(",").slice(-2))).toEqual([
          ["community-wasm", ""],
          ["community-wasm", "TIMEOUT"],
          ["native", ""],
          ["", ""],
        ]);
      } else {
        const rows =
          format === "json" ? JSON.parse(text) : text.split("\n").map((line) => JSON.parse(line));
        expect(rows).toEqual([
          expect.objectContaining({ parser_provenance: "community-wasm", sandbox_error: null }),
          expect.objectContaining({
            parser_provenance: "community-wasm",
            sandbox_error: "TIMEOUT",
          }),
          expect.objectContaining({ parser_provenance: "native", sandbox_error: null }),
          expect.objectContaining({ parser_provenance: null, sandbox_error: null }),
        ]);
      }
      expect(screen.getByText("Parser Provenance")).toBeInTheDocument();
      expect(screen.getByText("Sandbox Error")).toBeInTheDocument();
    }
  );

  it("uses the server export at the 5,000-event boundary", () => {
    const event = communityEvent();
    render(
      createElement(ExportDataDialog, {
        open: true,
        onOpenChange: vi.fn(),
        events: Array.from({ length: 5_000 }, () => event),
        contractId: event.raw.contractId,
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Export as NDJSON" }));
    fireEvent.click(screen.getByRole("button", { name: "Download NDJSON" }));

    expect(downloads).toHaveLength(0);
    expect(links).toHaveLength(1);
    const url = new URL(links[0]);
    expect(url.pathname).toBe("/api/v1/events/export");
    expect(url.searchParams.get("format")).toBe("ndjson");
    expect(url.searchParams.get("contractId")).toBe(event.raw.contractId);
  });
});
