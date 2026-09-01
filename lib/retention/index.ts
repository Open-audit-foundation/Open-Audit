/**
 * lib/retention/index.ts
 *
 * Public surface of the retention module.
 *
 * - `startRetentionScheduler` — call once at server startup; starts the
 *   node-cron job that prunes old rows on a configurable schedule.
 * - `pruneOldData` / `logPruneResult` — lower-level exports for the CLI
 *   script and tests.
 */

export { startRetentionScheduler } from "./scheduler";
export { pruneOldData, logPruneResult } from "./pruner";
export type { PruneOptions, PruneResult, TablePruneResult } from "./pruner";
