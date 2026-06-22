/**
 * Retention Pruner
 *
 * Stateful background routine that:
 *   1. Identifies Event rows older than RETENTION_DAYS
 *   2. Archives each batch to a compressed CSV flat-file (via archiver.ts)
 *   3. Deletes the archived rows from PostgreSQL in small batches to avoid
 *      lock contention on the hot table
 *   4. Emits structured execution logs for every cycle
 *
 * The pruner is intentionally decoupled from the cron scheduler so it can
 * also be invoked directly from the CLI script or tests.
 *
 * Scheduling is handled by node-cron when `schedulePruner()` is called from
 * the Next.js server entry point.
 */

import { db } from "@/lib/db/client";
import { archiveBatch } from "./archiver";
import { loadRetentionPolicy, getCutoffTimestamp, type RetentionPolicy } from "./policy";
import type { ArchiveResult } from "./archiver";

/** Summary emitted at the end of each pruner cycle. */
export interface PrunerCycleResult {
  /** ISO-8601 start time of the cycle. */
  startedAt: string;
  /** ISO-8601 end time of the cycle. */
  completedAt: string;
  /** Elapsed wall-clock time in milliseconds. */
  elapsedMs: number;
  /** Total event rows that qualified for archival. */
  candidateCount: number;
  /** Total rows successfully archived and deleted. */
  archivedCount: number;
  /** Total rows deleted from the Event table. */
  deletedCount: number;
  /** Archive files written during this cycle. */
  archives: ArchiveResult[];
  /** Number of batches processed. */
  batchesProcessed: number;
  /** Any non-fatal errors encountered per batch. */
  errors: Array<{ batchIndex: number; message: string }>;
  /** Whether the cycle ran in dry-run mode (no mutations). */
  dryRun: boolean;
}

/**
 * Runs a single pruner cycle synchronously from the perspective of the caller.
 * Each batch is archived then deleted before moving to the next, keeping peak
 * memory usage bounded to `policy.batchSize` rows.
 */
export async function runPrunerCycle(
  policyOverride?: Partial<RetentionPolicy>
): Promise<PrunerCycleResult> {
  const policy: RetentionPolicy = { ...loadRetentionPolicy(), ...policyOverride };
  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  const cutoffTimestamp = getCutoffTimestamp(policy);
  const cutoffDate = new Date(cutoffTimestamp * 1000).toISOString();

  console.log(
    `[retention/pruner] Starting cycle — cutoff=${cutoffDate} ` +
    `retentionDays=${policy.retentionDays} batchSize=${policy.batchSize} ` +
    `dryRun=${policy.dryRun}`
  );

  // ── Phase 1: Count candidates ──────────────────────────────────────────────
  const candidateCount = await db.event.count({
    where: { timestamp: { lt: cutoffTimestamp } },
  });

  console.log(`[retention/pruner] ${candidateCount} candidate rows found`);

  if (candidateCount === 0) {
    const completedAt = new Date().toISOString();
    return {
      startedAt,
      completedAt,
      elapsedMs: Date.now() - startMs,
      candidateCount: 0,
      archivedCount: 0,
      deletedCount: 0,
      archives: [],
      batchesProcessed: 0,
      errors: [],
      dryRun: policy.dryRun,
    };
  }

  // ── Phase 2: Batch archive → delete loop ──────────────────────────────────
  const archives: ArchiveResult[] = [];
  const errors: Array<{ batchIndex: number; message: string }> = [];
  let archivedCount = 0;
  let deletedCount = 0;
  let batchIndex = 0;

  // We process in cursor-style pages by taking the top N by (timestamp, id)
  // so the loop is safe even if rows are inserted while we're running.
  let lastId: string | null = null;

  while (true) {
    // Fetch the next batch — ordered by timestamp ASC, id ASC for stable pagination
    const batch = await db.event.findMany({
      where: {
        timestamp: { lt: cutoffTimestamp },
        ...(lastId ? { id: { gt: lastId } } : {}),
      },
      orderBy: [{ timestamp: "asc" }, { id: "asc" }],
      take: policy.batchSize,
      select: {
        id: true,
        contractId: true,
        ledger: true,
        timestamp: true,
        txHash: true,
        topics: true,
        data: true,
        description: true,
        status: true,
        blueprintName: true,
        eventType: true,
        createdAt: true,
      },
    });

    if (batch.length === 0) break;

    try {
      // Archive this batch to a compressed CSV
      const archiveResult = await archiveBatch(batch, batchIndex, policy);

      if (archiveResult && archiveResult.rowCount > 0) {
        archives.push(archiveResult);
        archivedCount += archiveResult.rowCount;
      }

      // Delete the archived rows from PostgreSQL
      if (!policy.dryRun) {
        const ids = batch.map((e) => e.id);
        const deleteResult = await db.event.deleteMany({
          where: { id: { in: ids } },
        });
        deletedCount += deleteResult.count;

        console.log(
          `[retention/pruner] Batch ${batchIndex + 1}: archived=${batch.length} deleted=${deleteResult.count}`
        );
      } else {
        console.log(
          `[retention/pruner] DRY RUN — Batch ${batchIndex + 1}: would delete ${batch.length} rows`
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[retention/pruner] Error in batch ${batchIndex}: ${message}`);
      errors.push({ batchIndex, message });
      // Continue to next batch — don't let one bad batch abort the whole cycle
    }

    lastId = batch[batch.length - 1].id;
    batchIndex++;

    // If the batch was smaller than requested, we've exhausted all candidates
    if (batch.length < policy.batchSize) break;
  }

  // ── Phase 3: Log VACUUM hint ───────────────────────────────────────────────
  // Postgres doesn't reclaim page space immediately after DELETE; VACUUM does.
  // We don't run VACUUM ourselves (it requires superuser in some configs and
  // autovacuum handles it in most PG deployments) but we log the advisory.
  if (!policy.dryRun && deletedCount > 0) {
    console.log(
      `[retention/pruner] ${deletedCount} rows deleted. ` +
      `autovacuum will reclaim table space. ` +
      `Run "VACUUM ANALYZE public.\\"Event\\";" manually if index bloat is observed.`
    );
  }

  const completedAt = new Date().toISOString();
  const result: PrunerCycleResult = {
    startedAt,
    completedAt,
    elapsedMs: Date.now() - startMs,
    candidateCount,
    archivedCount,
    deletedCount,
    archives,
    batchesProcessed: batchIndex,
    errors,
    dryRun: policy.dryRun,
  };

  console.log(
    `[retention/pruner] Cycle complete — ` +
    `elapsed=${result.elapsedMs}ms candidates=${candidateCount} ` +
    `archived=${archivedCount} deleted=${deletedCount} errors=${errors.length}`
  );

  return result;
}

/**
 * Registers the pruner as a recurring cron job using node-cron.
 *
 * Call this once from the application server entry point (server.ts).
 * The job runs at the time specified by `RETENTION_CRON` (default 02:00 UTC daily).
 *
 * If `RETENTION_ENABLED=false`, the function is a no-op.
 *
 * @returns A stop function that cancels the scheduled task.
 */
export function schedulePruner(): () => void {
  const policy = loadRetentionPolicy();

  if (!policy.enabled) {
    console.log("[retention/pruner] Retention is disabled (RETENTION_ENABLED=false). Skipping.");
    return () => {};
  }

  // Lazy-import node-cron so the module is only loaded when scheduling is needed.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const cron = require("node-cron");

  if (!cron.validate(policy.cronSchedule)) {
    console.error(
      `[retention/pruner] Invalid RETENTION_CRON expression: "${policy.cronSchedule}". ` +
      `Pruner will NOT be scheduled.`
    );
    return () => {};
  }

  console.log(
    `[retention/pruner] Scheduled — cron="${policy.cronSchedule}" ` +
    `retentionDays=${policy.retentionDays} dryRun=${policy.dryRun}`
  );

  const task = cron.schedule(policy.cronSchedule, async () => {
    console.log("[retention/pruner] Cron triggered — starting cycle...");
    try {
      const result = await runPrunerCycle();
      console.log("[retention/pruner] Cron cycle finished:", JSON.stringify(result, null, 2));
    } catch (err) {
      console.error("[retention/pruner] Unhandled error in cron cycle:", err);
    }
  });

  return () => {
    task.stop();
    console.log("[retention/pruner] Scheduled task stopped.");
  };
}
