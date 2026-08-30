#!/usr/bin/env tsx
/**
 * scripts/retention.ts
 *
 * CLI script for manually running the retention pruner.
 *
 * Usage:
 *   npm run retention               # live delete
 *   npm run retention:dry-run       # report only, no deletions
 *
 * Or directly with tsx:
 *   tsx scripts/retention.ts [--dry-run] [--days <n>] [--batch-cap <n>]
 *
 * Flags:
 *   --dry-run          Report what would be deleted without touching the DB.
 *   --days <n>         Retention threshold in days (default: $RETENTION_DAYS ?? 180).
 *   --batch-cap <n>    Max rows deleted per run (default: $ARCHIVE_BATCH_SIZE ?? 1000).
 */

import "dotenv/config";
import { Command } from "commander";
import { db } from "../lib/db/client";
import { pruneOldData, logPruneResult } from "../lib/retention/pruner";

const program = new Command();

program
  .name("retention")
  .description("Manually prune old Event, DeadLetterEvent, and WebhookDelivery rows.")
  .option("--dry-run", "Report intended deletions without deleting anything.", false)
  .option(
    "--days <number>",
    "Delete rows older than this many days.",
    String(parseInt(process.env.RETENTION_DAYS ?? "180", 10))
  )
  .option(
    "--batch-cap <number>",
    "Maximum rows to delete across all tables per run.",
    String(parseInt(process.env.ARCHIVE_BATCH_SIZE ?? "1000", 10))
  )
  .action(async (opts: { dryRun: boolean; days: string; batchCap: string }) => {
    const dryRun = opts.dryRun;
    const days = parseInt(opts.days, 10);
    const batchCap = parseInt(opts.batchCap, 10);

    if (!Number.isFinite(days) || days < 0) {
      console.error(`--days must be a non-negative integer (got: ${opts.days})`);
      process.exit(1);
    }
    if (!Number.isFinite(batchCap) || batchCap <= 0) {
      console.error(`--batch-cap must be a positive integer (got: ${opts.batchCap})`);
      process.exit(1);
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    console.log(
      JSON.stringify({
        level: "info",
        msg: dryRun ? "retention dry-run starting" : "retention run starting",
        cutoffDate: cutoffDate.toISOString(),
        retentionDays: days,
        batchCap,
      })
    );

    try {
      const result = await pruneOldData({ db, cutoffDate, batchCap, dryRun });
      logPruneResult(result);

      if (dryRun) {
        console.log(
          `\nDry-run summary: ${result.totalEligible} rows eligible, ` +
            `${result.totalDeleted} would be deleted (cap: ${batchCap}).\n` +
            "Run without --dry-run to apply."
        );
      } else {
        console.log(
          `\nDone: ${result.totalDeleted} rows deleted ` +
            `(${result.totalEligible} were eligible, cap: ${batchCap}).`
        );
      }
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "error",
          msg: "retention script failed",
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        })
      );
      process.exit(1);
    } finally {
      await db.$disconnect();
    }
  });

program.parse(process.argv);
