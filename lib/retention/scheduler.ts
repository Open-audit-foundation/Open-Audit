/**
 * lib/retention/scheduler.ts
 *
 * Wraps `pruneOldData` in a node-cron job.  Reads configuration from
 * environment variables so the schedule and thresholds can be tuned
 * without code changes.
 *
 * Environment variables (all optional with documented defaults):
 *
 *   RETENTION_ENABLED         — set to "false" to disable the scheduler
 *                               entirely.  Any other value (or unset) is
 *                               treated as enabled.  Default: true.
 *
 *   RETENTION_DAYS            — rows older than this many days are pruned.
 *                               Default: 180.
 *
 *   RETENTION_CRON_SCHEDULE   — node-cron expression for when to run.
 *                               Default: "0 3 * * *"  (daily at 03:00 UTC)
 *
 *   ARCHIVE_BATCH_SIZE        — maximum rows deleted per run across all
 *                               tables.  Default: 1000.
 *
 * Call `startRetentionScheduler()` once at server startup.  It returns the
 * scheduled task so callers can stop it (e.g. during tests or graceful
 * shutdown).
 */

import cron from "node-cron";
import { db } from "../db/client";
import { pruneOldData, logPruneResult } from "./pruner";

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

/** Parse an integer env var, falling back to `defaultValue` on invalid input. */
function envInt(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

/** Returns true unless RETENTION_ENABLED is explicitly set to "false". */
function isRetentionEnabled(): boolean {
  const val = process.env.RETENTION_ENABLED;
  return val !== "false";
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

/**
 * Start the retention scheduler.
 *
 * - When `RETENTION_ENABLED=false` this is a no-op; it logs a single info
 *   line and returns undefined so callers do not need to branch.
 * - Otherwise, schedules a node-cron job according to
 *   `RETENTION_CRON_SCHEDULE` (default: every day at 03:00 UTC).
 *
 * @returns The cron.ScheduledTask, or undefined when retention is disabled.
 */
export function startRetentionScheduler(): cron.ScheduledTask | undefined {
  if (!isRetentionEnabled()) {
    console.log(
      JSON.stringify({
        level: "info",
        msg: "retention scheduler disabled (RETENTION_ENABLED=false)",
      })
    );
    return undefined;
  }

  const retentionDays = envInt("RETENTION_DAYS", 180);
  const batchCap = envInt("ARCHIVE_BATCH_SIZE", 1000);
  const schedule = process.env.RETENTION_CRON_SCHEDULE ?? "0 3 * * *";

  if (!cron.validate(schedule)) {
    console.error(
      JSON.stringify({
        level: "error",
        msg: `retention scheduler: invalid cron expression "${schedule}" — scheduler not started`,
      })
    );
    return undefined;
  }

  console.log(
    JSON.stringify({
      level: "info",
      msg: "retention scheduler started",
      schedule,
      retentionDays,
      batchCap,
    })
  );

  const task = cron.schedule(schedule, async () => {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    console.log(
      JSON.stringify({
        level: "info",
        msg: "retention run starting",
        cutoffDate: cutoffDate.toISOString(),
        retentionDays,
        batchCap,
      })
    );

    try {
      const result = await pruneOldData({ db, cutoffDate, batchCap });
      logPruneResult(result);
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "error",
          msg: "retention run failed",
          error: err instanceof Error ? err.message : String(err),
        })
      );
    }
  });

  return task;
}
