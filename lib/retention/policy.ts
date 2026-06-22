/**
 * Retention Policy Configuration
 *
 * Reads retention settings from environment variables and exposes a typed
 * config object used by both the pruner and the archiver.
 *
 * Environment variables:
 *   RETENTION_DAYS          How many days of events to keep in the hot DB (default: 180)
 *   RETENTION_BATCH_SIZE    Rows processed per delete batch (default: 500)
 *   RETENTION_ARCHIVE_DIR   Local directory for CSV archive files (default: ./archives)
 *   RETENTION_CRON          Cron expression for the scheduled job (default: "0 2 * * *")
 *   RETENTION_ENABLED       Set to "false" to disable the cron entirely (default: "true")
 *   RETENTION_DRY_RUN       Set to "true" to log what would happen without mutating data
 */

export interface RetentionPolicy {
  /** Number of days to retain events in the hot PostgreSQL table. */
  retentionDays: number;

  /** Rows to archive + delete per iteration to limit lock contention. */
  batchSize: number;

  /** Local filesystem directory where CSV archives are written before cold-storage upload. */
  archiveDir: string;

  /** node-cron compatible expression. Defaults to daily at 02:00 UTC. */
  cronSchedule: string;

  /** When false the scheduled task is registered but never executes. */
  enabled: boolean;

  /**
   * Dry-run mode: scan and log candidates but skip archive write and delete.
   * Useful for auditing the policy against a production database.
   */
  dryRun: boolean;
}

/**
 * Loads and validates the retention policy from the process environment.
 * Safe to call at module load time — only reads env, never throws.
 */
export function loadRetentionPolicy(): RetentionPolicy {
  const retentionDays = parsePositiveInt(process.env.RETENTION_DAYS, 180);
  const batchSize = parsePositiveInt(process.env.RETENTION_BATCH_SIZE, 500);
  const archiveDir = process.env.RETENTION_ARCHIVE_DIR ?? "./archives";
  const cronSchedule = process.env.RETENTION_CRON ?? "0 2 * * *";
  const enabled = process.env.RETENTION_ENABLED !== "false";
  const dryRun = process.env.RETENTION_DRY_RUN === "true";

  return { retentionDays, batchSize, archiveDir, cronSchedule, enabled, dryRun };
}

/** Parses a string to a positive integer, falling back to the default. */
function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Returns a Date representing the cutoff point.
 * Events whose `timestamp` (Unix seconds) is older than this are candidates
 * for archival and deletion.
 */
export function getCutoffDate(policy: RetentionPolicy): Date {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - policy.retentionDays);
  cutoff.setUTCHours(0, 0, 0, 0); // Align to midnight UTC for reproducibility
  return cutoff;
}

/** Unix-seconds equivalent of the cutoff (matches the Event.timestamp column type). */
export function getCutoffTimestamp(policy: RetentionPolicy): number {
  return Math.floor(getCutoffDate(policy).getTime() / 1000);
}
