/**
 * lib/retention/__tests__/pruner.test.ts
 *
 * Unit tests for the retention pruner.
 *
 * Tests use a mock PrismaClient so no database is required.  The mock
 * simulates seeded rows at various ages so the pruner's selection logic
 * can be exercised in isolation.
 *
 * Test coverage:
 *  1. Age threshold: only rows past the cutoff date are deleted.
 *  2. RETENTION_ENABLED=false: startRetentionScheduler returns undefined (no-op).
 *  3. Batch-cap safety rail: no more than batchCap rows are deleted per run.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { pruneOldData } from "../pruner";
import type { PruneOptions } from "../pruner";
import type { PrismaClient } from "@prisma/client";

// ---------------------------------------------------------------------------
// Mock PrismaClient builder
// ---------------------------------------------------------------------------

/**
 * Builds a minimal Prisma mock that holds rows for the three retention
 * tables in memory.  Supports the subset of the Prisma API that the pruner
 * uses: count, aggregate (_min/_max createdAt), findMany (with take + orderBy),
 * and deleteMany (with id in).
 */
function buildMockDb(initialRows: {
  events?: Array<{ id: string; createdAt: Date }>;
  deadLetterEvents?: Array<{ id: string; createdAt: Date }>;
  webhookDeliveries?: Array<{ id: string; createdAt: Date }>;
}) {
  let events = [...(initialRows.events ?? [])];
  let deadLetterEvents = [...(initialRows.deadLetterEvents ?? [])];
  let webhookDeliveries = [...(initialRows.webhookDeliveries ?? [])];

  function makeTableMock(getRows: () => Array<{ id: string; createdAt: Date }>) {
    return {
      count: vi.fn(({ where }: { where: { createdAt: { lt: Date } } }) => {
        return Promise.resolve(
          getRows().filter((r) => r.createdAt < where.createdAt.lt).length
        );
      }),
      aggregate: vi.fn(({ where, _min, _max }: any) => {
        const matching = getRows().filter((r) => r.createdAt < where.createdAt.lt);
        const dates = matching.map((r) => r.createdAt.getTime());
        return Promise.resolve({
          _min: _min ? { createdAt: dates.length ? new Date(Math.min(...dates)) : null } : undefined,
          _max: _max ? { createdAt: dates.length ? new Date(Math.max(...dates)) : null } : undefined,
        });
      }),
      findMany: vi.fn(({ where, take, orderBy }: any) => {
        let rows = getRows().filter((r) => r.createdAt < where.createdAt.lt);
        // Apply orderBy createdAt asc
        rows = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        return Promise.resolve(rows.slice(0, take).map((r) => ({ id: r.id })));
      }),
      deleteMany: vi.fn(({ where }: { where: { id: { in: string[] } } }) => {
        const ids = new Set(where.id.in);
        const deleted = getRows().filter((r) => ids.has(r.id)).length;
        // Mutate the array in place
        const arr = getRows();
        const toRemove = arr.filter((r) => ids.has(r.id));
        toRemove.forEach((r) => arr.splice(arr.indexOf(r), 1));
        return Promise.resolve({ count: deleted });
      }),
    };
  }

  const db = {
    event: makeTableMock(() => events),
    deadLetterEvent: makeTableMock(() => deadLetterEvents),
    webhookDelivery: makeTableMock(() => webhookDeliveries),
  } as unknown as PrismaClient;

  return { db, events, deadLetterEvents, webhookDeliveries };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("pruneOldData", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Test 1: Age threshold — only rows past the cutoff are deleted
  // -------------------------------------------------------------------------
  it("deletes only rows older than the cutoff date and leaves newer rows intact", async () => {
    const { db, events, deadLetterEvents } = buildMockDb({
      events: [
        { id: "evt-old-1", createdAt: daysAgo(200) }, // older than 180 days → should be deleted
        { id: "evt-old-2", createdAt: daysAgo(190) }, // older than 180 days → should be deleted
        { id: "evt-new-1", createdAt: daysAgo(10) },  // newer → should survive
        { id: "evt-new-2", createdAt: daysAgo(1) },   // newer → should survive
      ],
      deadLetterEvents: [
        { id: "dle-old-1", createdAt: daysAgo(365) }, // older → should be deleted
        { id: "dle-new-1", createdAt: daysAgo(5) },   // newer → should survive
      ],
      webhookDeliveries: [],
    });

    const cutoffDate = daysAgo(180);
    const result = await pruneOldData({ db, cutoffDate, batchCap: 1000 });

    // Three rows should have been deleted (2 events + 1 dead-letter).
    expect(result.totalDeleted).toBe(3);
    expect(result.tables.Event.deleted).toBe(2);
    expect(result.tables.DeadLetterEvent.deleted).toBe(1);
    expect(result.tables.WebhookDelivery.deleted).toBe(0);

    // Eligible counts match what was seeded past the cutoff.
    expect(result.tables.Event.eligible).toBe(2);
    expect(result.tables.DeadLetterEvent.eligible).toBe(1);

    // Newer rows must still be present in the in-memory arrays.
    expect(events.map((r) => r.id)).toContain("evt-new-1");
    expect(events.map((r) => r.id)).toContain("evt-new-2");
    expect(events.map((r) => r.id)).not.toContain("evt-old-1");
    expect(events.map((r) => r.id)).not.toContain("evt-old-2");

    expect(deadLetterEvents.map((r) => r.id)).toContain("dle-new-1");
    expect(deadLetterEvents.map((r) => r.id)).not.toContain("dle-old-1");
  });

  // -------------------------------------------------------------------------
  // Test 2: RETENTION_ENABLED=false — see scheduler.test.ts
  // (That test requires a top-level vi.mock of lib/db/client so it lives
  //  in its own file to allow Vitest to hoist the mock correctly.)
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // Test 3: Batch-cap safety rail
  // -------------------------------------------------------------------------
  it("deletes no more than batchCap rows in total across all tables", async () => {
    const { db } = buildMockDb({
      events: Array.from({ length: 20 }, (_, i) => ({
        id: `evt-${i}`,
        createdAt: daysAgo(200),
      })),
      deadLetterEvents: Array.from({ length: 20 }, (_, i) => ({
        id: `dle-${i}`,
        createdAt: daysAgo(200),
      })),
      webhookDeliveries: Array.from({ length: 20 }, (_, i) => ({
        id: `wh-${i}`,
        createdAt: daysAgo(200),
      })),
    });

    const cutoffDate = daysAgo(180);
    const batchCap = 15;

    const result = await pruneOldData({ db, cutoffDate, batchCap });

    // Total deleted must never exceed batchCap.
    expect(result.totalDeleted).toBeLessThanOrEqual(batchCap);
    expect(result.totalDeleted).toBe(batchCap);

    // All 60 rows are eligible; the cap is reported faithfully.
    expect(result.totalEligible).toBe(60);
    expect(result.batchCap).toBe(batchCap);
  });

  // -------------------------------------------------------------------------
  // Test 4: Dry-run mode — no rows touched, counts are accurate
  // -------------------------------------------------------------------------
  it("dry-run mode reports the correct deletion counts without deleting anything", async () => {
    const { db, events } = buildMockDb({
      events: [
        { id: "evt-1", createdAt: daysAgo(200) },
        { id: "evt-2", createdAt: daysAgo(190) },
        { id: "evt-3", createdAt: daysAgo(5) },  // too new
      ],
      deadLetterEvents: [],
      webhookDeliveries: [],
    });

    const cutoffDate = daysAgo(180);
    const result = await pruneOldData({ db, cutoffDate, batchCap: 1000, dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.totalDeleted).toBe(2);   // would delete 2
    expect(result.totalEligible).toBe(2);

    // Nothing was actually removed from the in-memory store.
    expect(db.event.deleteMany).not.toHaveBeenCalled();
    expect(events).toHaveLength(3);
  });

  // -------------------------------------------------------------------------
  // Test 5: Boundary rows (exactly at cutoff) are not deleted
  // -------------------------------------------------------------------------
  it("rows created exactly at the cutoff date are NOT deleted (lt, not lte)", async () => {
    const cutoffDate = new Date("2024-01-01T00:00:00.000Z");

    const { db, events } = buildMockDb({
      events: [
        // Exactly at cutoff — should NOT be deleted (pruner uses lt, not lte).
        { id: "evt-boundary", createdAt: new Date("2024-01-01T00:00:00.000Z") },
        // One millisecond before cutoff — SHOULD be deleted.
        { id: "evt-just-before", createdAt: new Date("2023-12-31T23:59:59.999Z") },
      ],
    });

    const result = await pruneOldData({ db, cutoffDate, batchCap: 1000 });

    expect(result.totalDeleted).toBe(1);
    expect(events.map((r) => r.id)).toContain("evt-boundary");
    expect(events.map((r) => r.id)).not.toContain("evt-just-before");
  });
});
