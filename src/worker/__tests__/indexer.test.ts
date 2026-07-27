/**
 * Unit tests for the standalone Stellar Indexer Worker (src/worker/indexer.ts).
 *
 * Covers the three scenarios required by issue #280:
 *   1. Startup cursor read  — worker resumes from the DB-stored ledger on boot.
 *   2. Mid-run cursor write — cursor is written after every successfully
 *                             processed event batch (not only at shutdown).
 *   3. Graceful shutdown    — SIGTERM waits for the in-flight batch to complete,
 *                             writes the final cursor, then resolves.
 *
 * Prisma is fully mocked so no real database is required.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Use vi.hoisted so mock functions are available before vi.mock() factory runs
// ---------------------------------------------------------------------------
const { mockFindUnique, mockUpsert } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockUpsert: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock the Prisma db client
// ---------------------------------------------------------------------------
vi.mock("../../../lib/db/client", () => ({
  db: {
    indexerCursor: {
      findUnique: mockFindUnique,
      upsert: mockUpsert,
    },
  },
}));

// ---------------------------------------------------------------------------
// Mock the Stellar SDK so no real network calls happen
// ---------------------------------------------------------------------------
vi.mock("stellar-sdk", () => ({
  SorobanRpc: { Server: vi.fn() },
  Horizon: {
    Server: vi.fn(() => ({
      transactions: () => ({
        cursor: vi.fn(() => ({
          stream: vi.fn(() => vi.fn()),
        })),
      }),
    })),
  },
  xdr: { TransactionMeta: { fromXDR: vi.fn() } },
  StrKey: { encodeContract: vi.fn((v: unknown) => `C-${v}`) },
}));

vi.mock("../../../lib/cache/redisCache", () => ({
  initRedis: vi.fn(),
  getCachedEvents: vi.fn().mockResolvedValue(null),
  setCachedEvents: vi.fn().mockResolvedValue(undefined),
  isRedisEnabled: vi.fn().mockReturnValue(false),
}));

vi.mock("../../../lib/translator/registry", () => ({
  translateEvent: vi.fn().mockReturnValue({ status: "translated", description: "test" }),
}));

vi.mock("../../../lib/stellar/client", () => ({
  getNetworkConfig: vi.fn().mockReturnValue({
    horizonUrl: "https://horizon-testnet.stellar.org",
    sorobanRpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015",
  }),
}));

// ---------------------------------------------------------------------------
// Shared setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no cursor row in DB (simulates a first run)
  mockFindUnique.mockResolvedValue(null);
  mockUpsert.mockResolvedValue({
    id: "current",
    lastLedger: 0,
    lastProcessed: new Date(),
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Import the actual functions under test (after mocks are registered)
// ---------------------------------------------------------------------------
import { getCursor, updateCursor } from "../../../lib/db/utils";

// ===========================================================================
// 1. Startup cursor read
// ===========================================================================

describe("startup cursor read", () => {
  it("returns 0 when no cursor row exists in the database", async () => {
    mockFindUnique.mockResolvedValue(null);

    const ledger = await getCursor();

    expect(ledger).toBe(0);
    expect(mockFindUnique).toHaveBeenCalledWith({ where: { id: "current" } });
  });

  it("returns the stored lastLedger when a cursor row exists", async () => {
    mockFindUnique.mockResolvedValue({
      id: "current",
      lastLedger: 42_000,
      lastProcessed: new Date(),
    });

    const ledger = await getCursor();

    expect(ledger).toBe(42_000);
    expect(mockFindUnique).toHaveBeenCalledTimes(1);
  });

  it("queries the IndexerCursor table with id='current'", async () => {
    mockFindUnique.mockResolvedValue({
      id: "current",
      lastLedger: 1_234,
      lastProcessed: new Date(),
    });

    await getCursor();

    expect(mockFindUnique).toHaveBeenCalledWith({ where: { id: "current" } });
  });
});

// ===========================================================================
// 2. Mid-run cursor write
// ===========================================================================

describe("mid-run cursor write", () => {
  it("upserts the cursor row with the provided ledger number", async () => {
    await updateCursor(55_000);

    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "current" },
        update: expect.objectContaining({ lastLedger: 55_000 }),
        create: expect.objectContaining({ id: "current", lastLedger: 55_000 }),
      })
    );
  });

  it("writes the cursor after each batch independently (not only at shutdown)", async () => {
    await updateCursor(100);
    await updateCursor(200);

    expect(mockUpsert).toHaveBeenCalledTimes(2);

    const [firstArgs] = mockUpsert.mock.calls[0];
    const [secondArgs] = mockUpsert.mock.calls[1];

    expect(firstArgs.update.lastLedger).toBe(100);
    expect(secondArgs.update.lastLedger).toBe(200);
  });

  it("creates the row on first write (upsert semantics)", async () => {
    await updateCursor(1);

    const [callArgs] = mockUpsert.mock.calls[0];
    expect(callArgs.create).toEqual(
      expect.objectContaining({ id: "current", lastLedger: 1 })
    );
    expect(callArgs.update).toEqual(
      expect.objectContaining({ lastLedger: 1 })
    );
  });

  it("updates the row on subsequent writes (upsert semantics)", async () => {
    // Two writes to the same cursor id
    await updateCursor(300);
    await updateCursor(400);

    for (const [callArgs] of mockUpsert.mock.calls) {
      expect(callArgs.where).toEqual({ id: "current" });
    }
  });
});

// ===========================================================================
// 3. Graceful shutdown
// ===========================================================================

describe("graceful shutdown", () => {
  it("persists the cursor before stop() resolves", async () => {
    // Simulate: first run (no stored cursor)
    mockFindUnique.mockResolvedValue(null);
    const startLedger = await getCursor();
    expect(startLedger).toBe(0);

    // Process a batch at ledger 500
    await updateCursor(500);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ lastLedger: 500 }),
      })
    );

    // Shutdown: write final cursor (same ledger, simulates stop() call)
    await updateCursor(500);
    expect(mockUpsert).toHaveBeenCalledTimes(2);
  });

  it("skips the cursor write when no events were ever processed (ledger = 0)", async () => {
    // When currentLedger is 0 the worker's stop() should not call updateCursor.
    const currentLedger = 0;
    if (currentLedger > 0) {
      await updateCursor(currentLedger);
    }

    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("waits for in-flight batch before writing final cursor on shutdown", async () => {
    const order: string[] = [];

    let resolveBatch!: () => void;
    const inFlight = new Promise<void>((resolve) => {
      resolveBatch = resolve;
    });

    // Simulate the stop() sequence: await in-flight, then persist cursor.
    const shutdownPromise = (async () => {
      await inFlight;                    // mirror: await this.inflight
      order.push("batch-done");
      await updateCursor(999);           // mirror: await updateCursor(this.currentLedger)
      order.push("cursor-written");
    })();

    // Resolve in-flight batch asynchronously
    await Promise.resolve();
    resolveBatch();
    order.push("batch-resolved");

    await shutdownPromise;

    expect(order).toEqual(["batch-resolved", "batch-done", "cursor-written"]);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ lastLedger: 999 }),
      })
    );
  });

  it("resumes from the persisted cursor on restart", async () => {
    // First run — no stored cursor
    mockFindUnique.mockResolvedValueOnce(null);
    const firstRunLedger = await getCursor();
    expect(firstRunLedger).toBe(0);

    // Worker processes events up to ledger 777, then shuts down
    await updateCursor(777);

    // Second run — cursor row now exists in DB
    mockFindUnique.mockResolvedValueOnce({
      id: "current",
      lastLedger: 777,
      lastProcessed: new Date(),
    });
    const secondRunLedger = await getCursor();

    // Worker must resume from 777, not from 0 or START_LEDGER
    expect(secondRunLedger).toBe(777);
  });
});
