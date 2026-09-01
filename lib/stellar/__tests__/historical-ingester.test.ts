/**
 * Unit tests for lib/stellar/historical-ingester.ts (Issue #420)
 *
 * Covers:
 *   - ingestHistoricalRange happy path (single and multi-chunk)
 *   - Per-contract historical cursor is written with the correct id
 *   - Live "current" cursor is never touched
 *   - onChunkComplete and onComplete callbacks are invoked correctly
 *   - Dead-lettered events are counted in failedEvents (not silently dropped)
 *   - historicalCursorId naming convention
 *   - getHistoricalCursor returns 0 when no prior run exists
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RawEvent } from "@/lib/translator/types";

// ─── Mock: Prisma db ──────────────────────────────────────────────────────────
const cursorStore: Map<string, any> = new Map();

vi.mock("@/lib/db/client", () => ({
  db: {
    indexerCursor: {
      upsert: vi.fn(async ({ where, create, update }: any) => {
        const existing = cursorStore.get(where.id);
        if (existing) {
          const updated = { ...existing, ...update, updatedAt: new Date() };
          cursorStore.set(where.id, updated);
          return updated;
        }
        const row = { ...create, updatedAt: new Date() };
        cursorStore.set(where.id, row);
        return row;
      }),
      findUnique: vi.fn(async ({ where }: any) => cursorStore.get(where.id) ?? null),
    },
    event: {
      upsert: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
    },
    deadLetterEvent: {
      create: vi.fn().mockResolvedValue({}),
    },
  },
}));

// ─── Mock: fetchEventsWithRetry ───────────────────────────────────────────────
// Returns 1 synthetic event per chunk so we can count correctly.
vi.mock("@/lib/stellar/indexer", async () => {
  const actual = await vi.importActual<any>("@/lib/stellar/indexer");
  return {
    ...actual,
    fetchEventsWithRetry: vi.fn(async (_server: any, contractIds: string[], startLedger: number) => ({
      events: [
        {
          type: "contract",
          ledger: startLedger,
          ledgerClosedAt: "2026-06-17T17:11:21Z",
          contractId: contractIds[0],
          id: `${startLedger}-0000000000`,
          pagingToken: `${startLedger}-0000000000`,
          topic: ["AAAADwAAAAh0cmFuc2Zlcg=="],
          value: "AAAAAwAAAGQ=",
          txHash: `txhash-${startLedger}`,
        },
      ],
      latestLedger: startLedger,
      cursor: `${startLedger}-0000000000`,
    })),
  };
});

// ─── Mock: translateAndPersistBatch ──────────────────────────────────────────
vi.mock("@/lib/translator/persistence", () => ({
  translateAndPersistBatch: vi.fn(async (events: RawEvent[]) => ({
    successful: events.length,
    failed: 0,
    translated: events.map((e) => ({
      raw: e,
      description: "mocked translation",
      status: "translated",
      blueprintName: "Mock",
      eventType: "transfer",
      schemaVersion: null,
    })),
  })),
}));

// ─── Mock: Redis (unused in these tests) ─────────────────────────────────────
vi.mock("@/lib/cache/redisCache", () => ({
  isRedisEnabled: vi.fn().mockReturnValue(false),
  getCachedEvents: vi.fn().mockResolvedValue(null),
  setCachedEvents: vi.fn().mockResolvedValue(undefined),
  initRedis: vi.fn(),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────
import {
  ingestHistoricalRange,
  historicalCursorId,
  getHistoricalCursor,
  updateHistoricalCursor,
} from "../historical-ingester";
import { fetchEventsWithRetry } from "@/lib/stellar/indexer";
import { translateAndPersistBatch } from "@/lib/translator/persistence";
import { db } from "@/lib/db/client";
import { TESTNET_CONFIG } from "@/lib/stellar/client";

// ─── Tests ────────────────────────────────────────────────────────────────────

const CONTRACT_ID = "CTEST000000000000000000000000000000000000000000000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  cursorStore.clear();
});

describe("historicalCursorId", () => {
  it("produces a key distinct from the live cursor", () => {
    expect(historicalCursorId(CONTRACT_ID)).toBe(`historical:${CONTRACT_ID}`);
    expect(historicalCursorId(CONTRACT_ID)).not.toBe("current");
  });

  it("uses 'global' as the fallback when a plain global id is needed", () => {
    expect(historicalCursorId("global")).toBe("historical:global");
  });
});

describe("getHistoricalCursor", () => {
  it("returns 0 when no prior run exists for the contract", async () => {
    const cursor = await getHistoricalCursor(CONTRACT_ID);
    expect(cursor).toBe(0);
  });

  it("returns the saved ledger after updateHistoricalCursor is called", async () => {
    await updateHistoricalCursor(CONTRACT_ID, 500_000);
    const cursor = await getHistoricalCursor(CONTRACT_ID);
    expect(cursor).toBe(500_000);
  });
});

describe("updateHistoricalCursor", () => {
  it("writes to IndexerCursor with id = historical:<contractId>", async () => {
    await updateHistoricalCursor(CONTRACT_ID, 123_000);

    expect(db.indexerCursor.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: `historical:${CONTRACT_ID}` },
        create: expect.objectContaining({ lastLedger: 123_000 }),
      })
    );
  });

  it("never writes to IndexerCursor with id = 'current'", async () => {
    await updateHistoricalCursor(CONTRACT_ID, 200_000);

    const calls = vi.mocked(db.indexerCursor.upsert).mock.calls;
    const touchedLiveCursor = calls.some((c: any[]) => c[0]?.where?.id === "current");
    expect(touchedLiveCursor).toBe(false);
  });
});

describe("ingestHistoricalRange — single chunk", () => {
  it("returns a result with the correct contractId and range", async () => {
    const result = await ingestHistoricalRange({
      networkConfig: TESTNET_CONFIG,
      contractId: CONTRACT_ID,
      startSequence: 100_000,
      endSequence: 100_999,
      chunkSize: 1_000,
    });

    expect(result.contractId).toBe(CONTRACT_ID);
    expect(result.startSequence).toBe(100_000);
    expect(result.endSequence).toBe(100_999);
  });

  it("calls fetchEventsWithRetry once for a single-chunk range", async () => {
    await ingestHistoricalRange({
      networkConfig: TESTNET_CONFIG,
      contractId: CONTRACT_ID,
      startSequence: 100_000,
      endSequence: 100_999,
      chunkSize: 1_000,
    });

    expect(fetchEventsWithRetry).toHaveBeenCalledTimes(1);
  });

  it("calls translateAndPersistBatch with the normalised RawEvents", async () => {
    await ingestHistoricalRange({
      networkConfig: TESTNET_CONFIG,
      contractId: CONTRACT_ID,
      startSequence: 100_000,
      endSequence: 100_000,
      chunkSize: 1_000,
    });

    expect(translateAndPersistBatch).toHaveBeenCalledTimes(1);
    const [rawEvents] = vi.mocked(translateAndPersistBatch).mock.calls[0] as [RawEvent[]];
    expect(rawEvents.length).toBe(1);
    expect(rawEvents[0].contractId).toBe(CONTRACT_ID);
    expect(rawEvents[0].ledger).toBe(100_000);
  });

  it("sets totalChunks = 1 for a single-chunk range", async () => {
    const result = await ingestHistoricalRange({
      networkConfig: TESTNET_CONFIG,
      contractId: CONTRACT_ID,
      startSequence: 100_000,
      endSequence: 100_999,
      chunkSize: 1_000,
    });

    expect(result.totalChunks).toBe(1);
  });

  it("sets totalEvents = number of events returned by the mock RPC", async () => {
    const result = await ingestHistoricalRange({
      networkConfig: TESTNET_CONFIG,
      contractId: CONTRACT_ID,
      startSequence: 100_000,
      endSequence: 100_999,
      chunkSize: 1_000,
    });

    // Our mock returns 1 event per fetch; translateAndPersistBatch reports all as successful
    expect(result.totalEvents).toBe(1);
    expect(result.failedEvents).toBe(0);
  });

  it("advances the historical cursor after the chunk", async () => {
    await ingestHistoricalRange({
      networkConfig: TESTNET_CONFIG,
      contractId: CONTRACT_ID,
      startSequence: 100_000,
      endSequence: 100_999,
      chunkSize: 1_000,
    });

    const saved = await getHistoricalCursor(CONTRACT_ID);
    expect(saved).toBe(100_999); // chunkEnd = min(100000+1000-1, 100999) = 100999
  });
});

describe("ingestHistoricalRange — multi-chunk", () => {
  it("calls fetchEventsWithRetry once per chunk", async () => {
    // 3000-ledger range with chunkSize 1000 → 3 chunks
    await ingestHistoricalRange({
      networkConfig: TESTNET_CONFIG,
      contractId: CONTRACT_ID,
      startSequence: 200_000,
      endSequence: 202_999,
      chunkSize: 1_000,
    });

    expect(fetchEventsWithRetry).toHaveBeenCalledTimes(3);
  });

  it("accumulates totalChunks correctly across 3 chunks", async () => {
    const result = await ingestHistoricalRange({
      networkConfig: TESTNET_CONFIG,
      contractId: CONTRACT_ID,
      startSequence: 200_000,
      endSequence: 202_999,
      chunkSize: 1_000,
    });

    expect(result.totalChunks).toBe(3);
  });

  it("accumulates totalEvents across all chunks", async () => {
    // Mock returns 1 event per fetch → 3 events total
    const result = await ingestHistoricalRange({
      networkConfig: TESTNET_CONFIG,
      contractId: CONTRACT_ID,
      startSequence: 200_000,
      endSequence: 202_999,
      chunkSize: 1_000,
    });

    expect(result.totalEvents).toBe(3);
  });

  it("cursor ends at endSequence after multi-chunk run", async () => {
    await ingestHistoricalRange({
      networkConfig: TESTNET_CONFIG,
      contractId: CONTRACT_ID,
      startSequence: 200_000,
      endSequence: 202_999,
      chunkSize: 1_000,
    });

    const saved = await getHistoricalCursor(CONTRACT_ID);
    expect(saved).toBe(202_999);
  });
});

describe("ingestHistoricalRange — callbacks", () => {
  it("invokes onChunkComplete after each chunk with correct metadata", async () => {
    const chunkResults: any[] = [];

    await ingestHistoricalRange({
      networkConfig: TESTNET_CONFIG,
      contractId: CONTRACT_ID,
      startSequence: 300_000,
      endSequence: 301_999,
      chunkSize: 1_000,
      onChunkComplete: async (r) => { chunkResults.push(r); },
    });

    expect(chunkResults).toHaveLength(2);
    expect(chunkResults[0].chunkIndex).toBe(0);
    expect(chunkResults[0].startLedger).toBe(300_000);
    expect(chunkResults[0].endLedger).toBe(300_999);
    expect(chunkResults[1].chunkIndex).toBe(1);
    expect(chunkResults[1].startLedger).toBe(301_000);
    expect(chunkResults[1].endLedger).toBe(301_999);
  });

  it("invokes onComplete once with total counts", async () => {
    let completedTotal = -1;
    let completedChunks = -1;

    await ingestHistoricalRange({
      networkConfig: TESTNET_CONFIG,
      contractId: CONTRACT_ID,
      startSequence: 400_000,
      endSequence: 401_999,
      chunkSize: 1_000,
      onComplete: async (total, chunks) => {
        completedTotal = total;
        completedChunks = chunks;
      },
    });

    expect(completedTotal).toBe(2);  // 1 event × 2 chunks
    expect(completedChunks).toBe(2);
  });
});

describe("ingestHistoricalRange — failed events (DLQ path)", () => {
  it("counts events that translateAndPersistBatch marks as failed", async () => {
    // Override mock to simulate 1 success and 1 failure per batch
    vi.mocked(translateAndPersistBatch).mockResolvedValueOnce({
      successful: 0,
      failed: 1,
      translated: [],
    });

    const result = await ingestHistoricalRange({
      networkConfig: TESTNET_CONFIG,
      contractId: CONTRACT_ID,
      startSequence: 500_000,
      endSequence: 500_999,
      chunkSize: 1_000,
    });

    expect(result.failedEvents).toBe(1);
    expect(result.totalEvents).toBe(0);
  });
});

describe("cursor isolation — live vs historical", () => {
  it("a historical backfill never overwrites the live cursor", async () => {
    // Seed live cursor
    await db.indexerCursor.upsert({
      where: { id: "current" },
      create: { id: "current", lastLedger: 77_777, lastProcessed: new Date() },
      update: { lastLedger: 77_777, lastProcessed: new Date() },
    });

    await ingestHistoricalRange({
      networkConfig: TESTNET_CONFIG,
      contractId: CONTRACT_ID,
      startSequence: 600_000,
      endSequence: 600_999,
      chunkSize: 1_000,
    });

    const liveCursor = await db.indexerCursor.findUnique({ where: { id: "current" } });
    expect(liveCursor?.lastLedger).toBe(77_777); // unchanged
  });

  it("two contracts get independent historical cursors", async () => {
    const CONTRACT_A = "CA00000000000000000000000000000000000000000000000000000001";
    const CONTRACT_B = "CB00000000000000000000000000000000000000000000000000000002";

    await Promise.all([
      ingestHistoricalRange({
        networkConfig: TESTNET_CONFIG,
        contractId: CONTRACT_A,
        startSequence: 700_000,
        endSequence: 700_999,
        chunkSize: 1_000,
      }),
      ingestHistoricalRange({
        networkConfig: TESTNET_CONFIG,
        contractId: CONTRACT_B,
        startSequence: 800_000,
        endSequence: 800_999,
        chunkSize: 1_000,
      }),
    ]);

    const cursorA = await getHistoricalCursor(CONTRACT_A);
    const cursorB = await getHistoricalCursor(CONTRACT_B);

    expect(cursorA).toBe(700_999);
    expect(cursorB).toBe(800_999);
    expect(cursorA).not.toBe(cursorB);
  });
});
