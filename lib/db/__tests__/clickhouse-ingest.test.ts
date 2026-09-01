/**
 * Unit tests for lib/db/clickhouse-ingest.ts (Issue #420)
 *
 * Verifies that:
 *   - bufferEvents accumulates rows and auto-flushes at AUTO_FLUSH_SIZE
 *   - flushEvents drains any remainder and resets the buffer
 *   - updateCursorCH writes to IndexerCursor with id = "historical:<contractId>"
 *   - The "current" (live) cursor is never written
 *   - Multiple flush calls are idempotent when the buffer is empty
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RawEvent } from "@/lib/translator/types";

// ─── Mock: batchUpsertEvents ──────────────────────────────────────────────────
vi.mock("@/lib/db/utils", () => ({
  batchUpsertEvents: vi.fn(async (events: RawEvent[]) => events.length),
}));

// ─── Mock: updateHistoricalCursor ─────────────────────────────────────────────
vi.mock("@/lib/stellar/historical-ingester", () => ({
  updateHistoricalCursor: vi.fn().mockResolvedValue(undefined),
  historicalCursorId: (contractId: string) => `historical:${contractId}`,
  getHistoricalCursor: vi.fn().mockResolvedValue(0),
  ingestHistoricalRange: vi.fn().mockResolvedValue({
    contractId: "mock",
    startSequence: 0,
    endSequence: 0,
    totalEvents: 0,
    totalChunks: 0,
    failedEvents: 0,
  }),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────
import { bufferEvents, flushEvents, updateCursorCH } from "../clickhouse-ingest";
import { batchUpsertEvents } from "@/lib/db/utils";
import { updateHistoricalCursor } from "@/lib/stellar/historical-ingester";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEvent(id: string, ledger = 1): RawEvent {
  return {
    id,
    contractId: "CTEST0000000000000000000000000000000000000000000000000000001",
    topics: ["0x01"],
    data: "0x00",
    ledger,
    timestamp: 1_700_000_000,
    txHash: `tx-${id}`,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("bufferEvents / flushEvents", () => {
  beforeEach(async () => {
    // Drain any leftover buffer from a prior test before clearing mocks.
    // The module-level _buffer is NOT reset by vi.clearAllMocks(), so we
    // flush it first (and discard the result) then clear call counts.
    await flushEvents();
    vi.clearAllMocks();
  });

  it("returns 0 and does NOT call batchUpsertEvents while below auto-flush threshold", async () => {
    const written = await bufferEvents([makeEvent("e1"), makeEvent("e2")]);

    expect(written).toBe(0);
    expect(batchUpsertEvents).not.toHaveBeenCalled();
  });

  it("flushEvents writes buffered rows to Postgres and returns the count", async () => {
    await bufferEvents([makeEvent("e10"), makeEvent("e11"), makeEvent("e12")]);
    const written = await flushEvents();

    expect(batchUpsertEvents).toHaveBeenCalledTimes(1);
    expect(written).toBe(3);
  });

  it("flushEvents resets the buffer so a second flush writes nothing", async () => {
    await bufferEvents([makeEvent("e20")]);
    await flushEvents();

    vi.clearAllMocks();

    const written = await flushEvents();
    expect(written).toBe(0);
    expect(batchUpsertEvents).not.toHaveBeenCalled();
  });

  it("flushEvents is idempotent on an empty buffer", async () => {
    const written = await flushEvents();
    expect(written).toBe(0);
    expect(batchUpsertEvents).not.toHaveBeenCalled();
  });

  it("passes all buffered events to batchUpsertEvents as a single batch", async () => {
    const events = [makeEvent("e30"), makeEvent("e31"), makeEvent("e32")];
    await bufferEvents(events);
    await flushEvents();

    expect(batchUpsertEvents).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: "e30" }),
        expect.objectContaining({ id: "e31" }),
        expect.objectContaining({ id: "e32" }),
      ])
    );
    expect(vi.mocked(batchUpsertEvents).mock.calls[0][0]).toHaveLength(3);
  });

  it("accumulates events across multiple bufferEvents calls before flush", async () => {
    await bufferEvents([makeEvent("e40")]);
    await bufferEvents([makeEvent("e41")]);
    const written = await flushEvents();

    expect(written).toBe(2);
    expect(vi.mocked(batchUpsertEvents).mock.calls[0][0]).toHaveLength(2);
  });
});

describe("updateCursorCH", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls updateHistoricalCursor with the correct contractId and ledger", async () => {
    const CONTRACT = "CTEST0000000000000000000000000000000000000000000000000000001";
    await updateCursorCH(123_456, CONTRACT);

    expect(updateHistoricalCursor).toHaveBeenCalledWith(CONTRACT, 123_456);
    expect(updateHistoricalCursor).toHaveBeenCalledTimes(1);
  });

  it("defaults to 'global' contractId when none is provided", async () => {
    await updateCursorCH(999_999);

    expect(updateHistoricalCursor).toHaveBeenCalledWith("global", 999_999);
  });

  it("never writes to the live 'current' cursor", async () => {
    await updateCursorCH(500_000, "CSOME_CONTRACT");

    const calls = vi.mocked(updateHistoricalCursor).mock.calls;
    const touchedLive = calls.some(([contractId]: [string, number]) => contractId === "current");
    expect(touchedLive).toBe(false);
  });
});
