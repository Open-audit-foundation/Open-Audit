/**
 * Data Retention Cron Scheduler
 *
 * Runs the archive-and-purge routine on a configurable cron schedule,
 * defaulting to 03:00 UTC daily (off-peak).  Mirrors the pattern used by
 * lib/reconciliation/scheduler.ts so the two live side-by-side without
 * conflicts.
 *
 * Environment variables consumed
 *   RETENTION_CRON_SCHEDULE  – cron expression              (default "0 3 * * *")
 *   RETENTION_DAYS           – passed through to archiver   (default 180)
 *   ARCHIVE_BATCH_SIZE       – passed through to archiver   (default 1000)
 *   ARCHIVE_OUTPUT_DIR       – passed through to archiver   (default ./archives)
 */

import cron from "node-cron";
import { archiveAndPurgeOldEvents, getRetentionDays } from "./archiver";

// Module-level handle so we can stop/restart without leaking tasks
let retentionTask: cron.ScheduledTask | null = null;

// ── Scheduler lifecycle ─────────────────────────────────────────────────────

/**
 * Start the retention cron scheduler.
 * Safe to call multiple times — a running scheduler is stopped first.
 */
export function startRetentionScheduler(): void {
  const schedule = process.env.RETENTION_CRON_SCHEDULE ?? "0 3 * * *";

  if (!cron.validate(schedule)) {
    console.error(`[retention-scheduler] Invalid cron expression: "${schedule}". Scheduler not started.`);
    return;
  }

  if (retentionTask) {
    console.log("[retention-scheduler] Replacing existing scheduler...");
    stopRetentionScheduler();
  }

  console.log(
    `[retention-scheduler] Starting — schedule="${schedule}", retentionDays=${getRetentionDays()}`
  );

  retentionTask = cron.schedule(schedule, async () => {
    console.log("[retention-scheduler] Cron tick — running archive-and-purge...");
    try {
      const result = await archiveAndPurgeOldEvents();

      if (result.success) {
        console.log(
          `[retention-scheduler] Run succeeded — ` +
            `archived=${result.rowsArchived}, deleted=${result.rowsDeleted}, ` +
            `file="${result.archiveFile}", duration=${result.durationMs}ms`
        );
      } else {
        console.error(`[retention-scheduler] Run failed — ${result.error}`);
      }
    } catch (err) {
      console.error("[retention-scheduler] Unexpected error during cron tick:", err);
    }
  });

  retentionTask.start();
  console.log("[retention-scheduler] Scheduler started.");
}

/**
 * Stop the retention cron scheduler.
 */
export function stopRetentionScheduler(): void {
  if (retentionTask) {
    retentionTask.stop();
    retentionTask.destroy();
    retentionTask = null;
    console.log("[retention-scheduler] Scheduler stopped.");
  }
}

/**
 * Return the current scheduler status.
 */
export function getRetentionSchedulerStatus(): {
  running: boolean;
  schedule: string;
  retentionDays: number;
  nextRun: string | null;
} {
  const schedule = process.env.RETENTION_CRON_SCHEDULE ?? "0 3 * * *";
  return {
    running: retentionTask !== null,
    schedule,
    retentionDays: getRetentionDays(),
    nextRun: retentionTask ? retentionTask.nextDate().toString() : null,
  };
}

/**
 * Trigger an immediate ad-hoc archive-and-purge run (bypass cron schedule).
 * Useful for manual maintenance or testing.
 */
export async function triggerRetentionNow(): Promise<ReturnType<typeof archiveAndPurgeOldEvents>> {
  console.log("[retention-scheduler] Manual trigger — running archive-and-purge immediately...");
  return archiveAndPurgeOldEvents();
}
