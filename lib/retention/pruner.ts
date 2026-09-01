/**
 * lib/retention/pruner.ts
 *
 * Core retention pruning logic. Deletes rows older than a configurable age
 * threshold from Event, DeadLetterEvent, and WebhookDelivery tables.
 *
 * Design goals:
 *  - Pure function over a PrismaClient, so it can be called by the scheduler
 *    OR directly from the CLI script without any side effects.
 *  - Dry-run mode: counts what *would* be deleted without touching the DB.
 *  - Batch-delete safety rail: never deletes more than `batchCap` rows total
 *    per invocation to avoid long-running transactions on large tables.
 *  - Structured log output for operator auditing.
 */

import type { PrismaClient } from "@prisma/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PruneOptions {
  /** Prisma client to use. Injected so tests can pass a mock. */
  db: PrismaClient;
  /** Rows older than this Date will be targeted for deletion. */
  cutoffDate: Date;
  /**
   * Maximum number of rows to delete across all tables in one invocation.
   * When `dryRun` is true this is used only to cap the count that is
   * reported, not to limit any actual work.
   * Default: 1000
   */
  batchCap?: number;
  /**
   * When true, count affected rows but do not delete anything.
   * Default: false
   */
  dryRun?: boolean;
}

export interface TablePruneResult {
  /** Total rows targeted (before batchCap is applied). */
  eligible: number;
  /** Rows actually deleted (or that would be deleted in dry-run). */
  deleted: number;
  /** createdAt of the oldest eligible row, or null when none found. */
  oldest: Date | null;
  /** createdAt of the newest eligible row, or null when none found. */
  newest: Date | null;
}

export interface PruneResult {
  dryRun: boolean;
  cutoffDate: Date;
  batchCap: number;
  tables: {
    Event: TablePruneResult;
    DeadLetterEvent: TablePruneResult;
    WebhookDelivery: TablePruneResult;
  };
  totalEligible: number;
  totalDeleted: number;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Count rows and find oldest/newest timestamps without deleting anything. */
async function countAndBoundaries(
  db: PrismaClient,
  table: "event" | "deadLetterEvent" | "webhookDelivery",
  cutoffDate: Date
): Promise<{ count: number; oldest: Date | null; newest: Date | null }> {
  // Prisma does not expose a generic aggregate with min/max on arbitrary
  // models via a shared interface, so we handle each table explicitly.
  if (table === "event") {
    const [count, bounds] = await Promise.all([
      db.event.count({ where: { createdAt: { lt: cutoffDate } } }),
      db.event.aggregate({
        where: { createdAt: { lt: cutoffDate } },
        _min: { createdAt: true },
        _max: { createdAt: true },
      }),
    ]);
    return {
      count,
      oldest: bounds._min.createdAt ?? null,
      newest: bounds._max.createdAt ?? null,
    };
  }

  if (table === "deadLetterEvent") {
    const [count, bounds] = await Promise.all([
      db.deadLetterEvent.count({ where: { createdAt: { lt: cutoffDate } } }),
      db.deadLetterEvent.aggregate({
        where: { createdAt: { lt: cutoffDate } },
        _min: { createdAt: true },
        _max: { createdAt: true },
      }),
    ]);
    return {
      count,
      oldest: bounds._min.createdAt ?? null,
      newest: bounds._max.createdAt ?? null,
    };
  }

  // webhookDelivery
  const [count, bounds] = await Promise.all([
    db.webhookDelivery.count({ where: { createdAt: { lt: cutoffDate } } }),
    db.webhookDelivery.aggregate({
      where: { createdAt: { lt: cutoffDate } },
      _min: { createdAt: true },
      _max: { createdAt: true },
    }),
  ]);
  return {
    count,
    oldest: bounds._min.createdAt ?? null,
    newest: bounds._max.createdAt ?? null,
  };
}

/**
 * Delete at most `limit` rows from a table older than `cutoffDate`.
 *
 * Prisma does not support `deleteMany` with a `take` (LIMIT) clause, so we
 * first select the IDs of the rows to delete and then delete by ID. This
 * keeps the transaction short and predictable.
 */
async function deleteBatch(
  db: PrismaClient,
  table: "event" | "deadLetterEvent" | "webhookDelivery",
  cutoffDate: Date,
  limit: number
): Promise<number> {
  if (table === "event") {
    const rows = await db.event.findMany({
      where: { createdAt: { lt: cutoffDate } },
      select: { id: true },
      take: limit,
      orderBy: { createdAt: "asc" },
    });
    if (rows.length === 0) return 0;
    const result = await db.event.deleteMany({
      where: { id: { in: rows.map((r) => r.id) } },
    });
    return result.count;
  }

  if (table === "deadLetterEvent") {
    const rows = await db.deadLetterEvent.findMany({
      where: { createdAt: { lt: cutoffDate } },
      select: { id: true },
      take: limit,
      orderBy: { createdAt: "asc" },
    });
    if (rows.length === 0) return 0;
    const result = await db.deadLetterEvent.deleteMany({
      where: { id: { in: rows.map((r) => r.id) } },
    });
    return result.count;
  }

  // webhookDelivery
  const rows = await db.webhookDelivery.findMany({
    where: { createdAt: { lt: cutoffDate } },
    select: { id: true },
    take: limit,
    orderBy: { createdAt: "asc" },
  });
  if (rows.length === 0) return 0;
  const result = await db.webhookDelivery.deleteMany({
    where: { id: { in: rows.map((r) => r.id) } },
  });
  return result.count;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Prune rows older than `cutoffDate` from the three retention-eligible tables.
 *
 * The total number of rows deleted across all tables is capped at `batchCap`
 * (default 1000). In `dryRun` mode, no rows are deleted; the function only
 * counts what would be removed.
 */
export async function pruneOldData(options: PruneOptions): Promise<PruneResult> {
  const { db, cutoffDate, batchCap = 1000, dryRun = false } = options;
  const startedAt = Date.now();

  // Count eligible rows and find boundaries for all three tables in parallel.
  const [eventStats, deadLetterStats, webhookStats] = await Promise.all([
    countAndBoundaries(db, "event", cutoffDate),
    countAndBoundaries(db, "deadLetterEvent", cutoffDate),
    countAndBoundaries(db, "webhookDelivery", cutoffDate),
  ]);

  const totalEligible =
    eventStats.count + deadLetterStats.count + webhookStats.count;

  // In dry-run mode we stop here.
  if (dryRun) {
    const eventDryDeleted = Math.min(eventStats.count, batchCap);
    const remainingAfterEvents = Math.max(0, batchCap - eventDryDeleted);
    const deadLetterDryDeleted = Math.min(deadLetterStats.count, remainingAfterEvents);
    const remainingAfterDead = Math.max(0, remainingAfterEvents - deadLetterDryDeleted);
    const webhookDryDeleted = Math.min(webhookStats.count, remainingAfterDead);
    const totalDeleted = eventDryDeleted + deadLetterDryDeleted + webhookDryDeleted;

    return {
      dryRun: true,
      cutoffDate,
      batchCap,
      tables: {
        Event: {
          eligible: eventStats.count,
          deleted: eventDryDeleted,
          oldest: eventStats.oldest,
          newest: eventStats.newest,
        },
        DeadLetterEvent: {
          eligible: deadLetterStats.count,
          deleted: deadLetterDryDeleted,
          oldest: deadLetterStats.oldest,
          newest: deadLetterStats.newest,
        },
        WebhookDelivery: {
          eligible: webhookStats.count,
          deleted: webhookDryDeleted,
          oldest: webhookStats.oldest,
          newest: webhookStats.newest,
        },
      },
      totalEligible,
      totalDeleted,
      durationMs: Date.now() - startedAt,
    };
  }

  // Live delete — distribute the batchCap budget across tables in order.
  let remainingBudget = batchCap;

  const eventDeleted = remainingBudget > 0
    ? await deleteBatch(db, "event", cutoffDate, remainingBudget)
    : 0;
  remainingBudget = Math.max(0, remainingBudget - eventDeleted);

  const deadLetterDeleted = remainingBudget > 0
    ? await deleteBatch(db, "deadLetterEvent", cutoffDate, remainingBudget)
    : 0;
  remainingBudget = Math.max(0, remainingBudget - deadLetterDeleted);

  const webhookDeleted = remainingBudget > 0
    ? await deleteBatch(db, "webhookDelivery", cutoffDate, remainingBudget)
    : 0;

  const totalDeleted = eventDeleted + deadLetterDeleted + webhookDeleted;

  return {
    dryRun: false,
    cutoffDate,
    batchCap,
    tables: {
      Event: {
        eligible: eventStats.count,
        deleted: eventDeleted,
        oldest: eventStats.oldest,
        newest: eventStats.newest,
      },
      DeadLetterEvent: {
        eligible: deadLetterStats.count,
        deleted: deadLetterDeleted,
        oldest: deadLetterStats.oldest,
        newest: deadLetterStats.newest,
      },
      WebhookDelivery: {
        eligible: webhookStats.count,
        deleted: webhookDeleted,
        oldest: webhookStats.oldest,
        newest: webhookStats.newest,
      },
    },
    totalEligible,
    totalDeleted,
    durationMs: Date.now() - startedAt,
  };
}

/**
 * Emit a structured log entry for a completed prune run.
 * This is separated from `pruneOldData` so callers can suppress output
 * or redirect it (e.g. to pino, a metrics sink, etc.).
 */
export function logPruneResult(result: PruneResult): void {
  const mode = result.dryRun ? "[DRY-RUN]" : "[PRUNED]";
  const cutoff = result.cutoffDate.toISOString();

  console.log(
    JSON.stringify({
      level: "info",
      msg: `retention ${mode}`,
      cutoffDate: cutoff,
      batchCap: result.batchCap,
      totalEligible: result.totalEligible,
      totalDeleted: result.totalDeleted,
      durationMs: result.durationMs,
      tables: {
        Event: result.tables.Event,
        DeadLetterEvent: result.tables.DeadLetterEvent,
        WebhookDelivery: result.tables.WebhookDelivery,
      },
    })
  );
}
