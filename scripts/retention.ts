#!/usr/bin/env ts-node
/**
 * Retention Pruner CLI
 *
 * Manually trigger a retention cycle or run a dry-run audit from the terminal.
 *
 * Usage:
 *   npx ts-node scripts/retention.ts [options]
 *
 * Options:
 *   --dry-run           Scan and log candidates without writing archives or deleting rows
 *   --days <N>          Override RETENTION_DAYS for this run
 *   --batch-size <N>    Override RETENTION_BATCH_SIZE for this run
 *   --archive-dir <D>   Override RETENTION_ARCHIVE_DIR for this run
 *   --help              Print this message
 *
 * Environment variables (can also be set in .env.local):
 *   DATABASE_URL        PostgreSQL connection string (required)
 *   RETENTION_DAYS      Days of events to retain (default: 180)
 *   RETENTION_BATCH_SIZE Rows per batch (default: 500)
 *   RETENTION_ARCHIVE_DIR Output directory for archives (default: ./archives)
 *   RETENTION_DRY_RUN   Set "true" to enable dry-run globally
 *
 * Examples:
 *   # Dry-run to see what would be pruned
 *   npx ts-node scripts/retention.ts --dry-run
 *
 *   # Prune events older than 90 days
 *   npx ts-node scripts/retention.ts --days 90
 *
 *   # Prune with smaller batches to reduce lock pressure
 *   npx ts-node scripts/retention.ts --days 180 --batch-size 100
 */

// Load .env.local before anything else
import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { runPrunerCycle } from "../lib/retention/pruner";
import { loadRetentionPolicy } from "../lib/retention/policy";
import type { RetentionPolicy } from "../lib/retention/policy";

interface CliArgs {
  dryRun: boolean;
  days?: number;
  batchSize?: number;
  archiveDir?: string;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { dryRun: false, help: false };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];

    switch (flag) {
      case "--dry-run":
        args.dryRun = true;
        break;

      case "--days": {
        const val = parseInt(argv[++i], 10);
        if (!Number.isFinite(val) || val < 1) {
          console.error("--days must be a positive integer");
          process.exit(1);
        }
        args.days = val;
        break;
      }

      case "--batch-size": {
        const val = parseInt(argv[++i], 10);
        if (!Number.isFinite(val) || val < 1) {
          console.error("--batch-size must be a positive integer");
          process.exit(1);
        }
        args.batchSize = val;
        break;
      }

      case "--archive-dir":
        args.archiveDir = argv[++i];
        break;

      case "--help":
      case "-h":
        args.help = true;
        break;

      default:
        console.warn(`Unknown flag: ${flag}`);
    }
  }

  return args;
}

function printHelp(): void {
  console.log(`
Retention Pruner CLI

Usage:
  npx ts-node scripts/retention.ts [options]

Options:
  --dry-run           Scan and log candidates without writing archives or deleting rows
  --days <N>          Override RETENTION_DAYS for this run
  --batch-size <N>    Override RETENTION_BATCH_SIZE for this run
  --archive-dir <D>   Override RETENTION_ARCHIVE_DIR for this run
  --help              Print this message

Environment variables:
  DATABASE_URL          PostgreSQL connection string (required)
  RETENTION_DAYS        Days of events to retain (default: 180)
  RETENTION_BATCH_SIZE  Rows per batch (default: 500)
  RETENTION_ARCHIVE_DIR Output directory for archives (default: ./archives)
  RETENTION_DRY_RUN     Set "true" to enable dry-run mode globally

Examples:
  npx ts-node scripts/retention.ts --dry-run
  npx ts-node scripts/retention.ts --days 90 --archive-dir /mnt/cold-storage
`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  // Build override from CLI args
  const override: Partial<RetentionPolicy> = {};
  if (args.dryRun) override.dryRun = true;
  if (args.days !== undefined) override.retentionDays = args.days;
  if (args.batchSize !== undefined) override.batchSize = args.batchSize;
  if (args.archiveDir !== undefined) override.archiveDir = args.archiveDir;

  const effectivePolicy = { ...loadRetentionPolicy(), ...override };

  console.log("\n[retention/cli] Effective policy:");
  console.log(`  retentionDays  : ${effectivePolicy.retentionDays}`);
  console.log(`  batchSize      : ${effectivePolicy.batchSize}`);
  console.log(`  archiveDir     : ${effectivePolicy.archiveDir}`);
  console.log(`  dryRun         : ${effectivePolicy.dryRun}`);
  console.log(`  enabled        : ${effectivePolicy.enabled}`);
  console.log("");

  try {
    const result = await runPrunerCycle(override);

    console.log("\n[retention/cli] Cycle result:");
    console.log(`  Started        : ${result.startedAt}`);
    console.log(`  Completed      : ${result.completedAt}`);
    console.log(`  Elapsed        : ${result.elapsedMs}ms`);
    console.log(`  Candidates     : ${result.candidateCount}`);
    console.log(`  Archived rows  : ${result.archivedCount}`);
    console.log(`  Deleted rows   : ${result.deletedCount}`);
    console.log(`  Batches        : ${result.batchesProcessed}`);
    console.log(`  Errors         : ${result.errors.length}`);

    if (result.archives.length > 0) {
      console.log("\n  Archive files:");
      for (const archive of result.archives) {
        console.log(
          `    ${archive.filePath}  (${archive.rowCount} rows, ${archive.compressedBytes} bytes)`
        );
      }
    }

    if (result.errors.length > 0) {
      console.log("\n  Errors:");
      for (const err of result.errors) {
        console.error(`    Batch ${err.batchIndex}: ${err.message}`);
      }
      process.exit(1);
    }

    process.exit(0);
  } catch (err) {
    console.error("\n[retention/cli] Fatal error:", err);
    process.exit(1);
  }
}

main();
