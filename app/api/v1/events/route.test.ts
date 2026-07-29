import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// lib/api/error-response.ts pulls in lib/telemetry.ts, which initializes an
// OpenTelemetry NodeSDK at import time -- unrelated to this route's logic,
// so it's stubbed out to keep this test focused and side-effect free.
vi.mock("@/lib/telemetry", () => ({
  captureException: vi.fn(),
  captureExceptionSync: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  db: {
    event: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/api/middleware", () => ({
  authenticateAndRateLimit: vi.fn().mockResolvedValue(null),
}));

import { db } from "@/lib/db/client";
import { GET } from "./route";

const DB_ROW = {
  id: "0000010-0",
  contractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  ledger: 100,
  timestamp: 1_700_000_000,
  txHash: "deadbeef",
  topics: ["0x1", "0x2"],
  data: "0x03",
  description: "Sent 100 USDC from GABC...WXYZ to GDEF...UVWX",
  status: "translated",
  blueprintName: "Stellar Asset Contract (SAC)",
  eventType: "Transfer",
};

describe("GET /api/v1/events", () => {
  beforeEach(() => {
    vi.mocked(db.event.findMany).mockReset();
  });

  it("returns the translated fields already stored in the database instead of stripping them", async () => {
    vi.mocked(db.event.findMany).mockResolvedValueOnce([DB_ROW] as any);

    const req = new NextRequest("http://localhost/api/v1/events?limit=50");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveLength(1);

    const event = body[0];
    // Bug 3: previously the route discarded these fields entirely.
    expect(event.description).toBe(DB_ROW.description);
    expect(event.status).toBe(DB_ROW.status);
    expect(event.blueprintName).toBe(DB_ROW.blueprintName);
    expect(event.eventType).toBe(DB_ROW.eventType);

    // Raw fields are nested under `.raw`, matching TranslatedEvent's shape.
    expect(event.raw).toEqual({
      id: DB_ROW.id,
      contractId: DB_ROW.contractId,
      topics: DB_ROW.topics,
      data: DB_ROW.data,
      ledger: DB_ROW.ledger,
      timestamp: DB_ROW.timestamp,
      txHash: DB_ROW.txHash,
    });
  });

  it("does not silently downgrade a translated event's status", async () => {
    vi.mocked(db.event.findMany).mockResolvedValueOnce([
      { ...DB_ROW, id: "0000010-1", blueprintName: null, eventType: null, description: null, status: "cryptic" },
    ] as any);

    const req = new NextRequest("http://localhost/api/v1/events");
    const res = await GET(req);
    const body = await res.json();

    expect(body[0].status).toBe("cryptic");
    expect(body[0].description).toBeNull();
  });
});
