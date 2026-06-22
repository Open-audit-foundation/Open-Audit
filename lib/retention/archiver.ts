/**
 * Data Retention Archiver
 *
 * Extracts historical Event rows that exceed the configured retention window
 * into compressed CSV flat files, then deletes the matching rows from the
 * relational table.  Designed to run during off-peak periods via the
 * retention scheduler (lib/retention/scheduler.ts).
 *
 * Archive format  : gzip-compressed CSV  (open-audit-archive-<ISO-date>.csv.gz)
 * Archive location: configurable via ARCHIVE_OUTPUT_DIR (default: ./archives)
 *
 * Environment variables consumed
 *   RETENTION_DAYS        – rows older than this many days are archived  (default 180)
 *   ARCHIVE_BATCH_SIZE    – rows processed per DB round-trip              (default 1000)
 *   ARCHIVE_OUTPUT_DIR    – directory for archive flat files              (default ./archives)
 */

import fs from "fs";
import path from "path";
import zlib from "zlib";
import { pipeline } from "stream/promises";
import { Readable, PassThrough } from "stream";
import { db } from "@/lib/db/client";

// ── Config helpers ──────────────────────────────────────────────────────────

export function getRetentionDays(): number {
  const val = parseInt(process.env.RETENTION_DAYS ?? "180", 10);
  return Number.isFinite(val) && val > 0 ? val : 180;
}

export function getArchiveBatchSize(): number {
  const val = parseInt(process.env.ARCHIVE_BATCH_SIZE ?? "1000", 10);
  return Number.isFinite(val) && val > 0 ? val : 1000;
}

export function getArchiveOutputDir(): string {
  return process.env.ARCHIVE_OUTPUT_DIR ?? path.join(process.cwd(), "archives");
}

// ── CSV helpers ─────────────────────────────────────────────────────────────

const CSV_HEADER =
  "id,contractId,ledger,timestamp,txHash,topics,data,description,status,blueprintName,eventType,rpcVerified,lastRpcCheck,discrepancies,createdAt,updatedAt\r\n";

function escapeCSVCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function rowToCSVLine(row: Record<string, unknown>): string {
  return [
    row.id,
    row.contractId,
    row.ledger,
    row.timestamp,
    row.txHash,
    escapeCSVCell(row.topics),
    escapeCSVCell(row.data),
    escapeCSVCell(row.description),
    row.status,
    escapeCSVCell(row.blueprintName),
    escapeCSVCell(row.eventType),
    row.rpcVerified,
    row.lastRpcCheck,
    escapeCSVCell(row.discrepancies),
    row.createdAt,
    row.updatedAt,
  ]
    .map(escapeCSVCell)
    .join(",") + "\r\n";
}

// ── Archive result type ─────────────────────────────────────────────────────

export interface ArchiveResult {
  /** ISO date string this run targeted (records older than cutoff) */
  cutoffDate: string;
  /** Number of rows written to the archive file */
  rowsArchived: number;
  /** Number of rows deleted from the relational table */
  rowsDeleted: number;
  /** Absolute path of the archive file produced (empty string if no rows) */
  archiveFile: string;
  /** Wall-clock duration in milliseconds */
  durationMs: number;
  /** Whether the run succeeded */
  success: boolean;
  /** Error message if success === false */
  error?: string;
}

// ── Core archival logic ─────────────────────────────────────────────────────

/**
 * Archive and purge events older than `retentionDays` days.
 *
 * Steps
 *  1. Identify the cutoff timestamp.
 *  2. Stream rows in batches into a gzip-compressed CSV file.
 *  3. Verify row counts match between written and fetched rows.
 *  4. Delete archived rows from the Event table in the same batches.
 *  5. Return a structured result for the calling scheduler to log.
 */
export async function archiveAndPurgeOldEvents(
  retentionDays = getRetentionDays(),
  batchSize = getArchiveBatchSize(),
  outputDir = getArchiveOutputDir()
): Promise<ArchiveResult> {
  const start = Date.now();
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const cutoffISO = cutoff.toISOString();

  console.log(
    `[archiver] Starting archive run — retentionDays=${retentionDays}, cutoff=${cutoffISO}`
  );

  // Early-exit if there is nothing to archive
  const totalEligible = await db.event.count({
    where: { createdAt: { lt: cutoff } },
  });

  if (totalEligible === 0) {
    console.log("[archiver] No rows eligible for archival — exiting early.");
    return {
      cutoffDate: cutoffISO,
      rowsArchived: 0,
      rowsDeleted: 0,
      archiveFile: "",
      durationMs: Date.now() - start,
      success: true,
    };
  }

  console.log(`[archiver] ${totalEligible} rows eligible for archival.`);

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const dateSlug = new Date().toISOString().slice(0, 10);
  const archiveFile = path.join(outputDir, `open-audit-archive-${dateSlug}.csv.gz`);

  try {
    // ── Phase 1: Stream rows to gzip CSV ──────────────────────────────────

    const pass = new PassThrough();
    const gzip = zlib.createGzip({ level: zlib.constants.Z_BEST_COMPRESSION });
    const fileStream = fs.createWriteStream(archiveFile);

    // Start the pipeline asynchronously; we push data into `pass` below
    const pipelinePromise = pipeline(pass, gzip, fileStream);

    pass.write(Buffer.from(CSV_HEADER, "utf8"));

    let cursor: string | undefined = undefined;
    let rowsArchived = 0;
    const archivedIds: string[] = [];

    while (true) {
      const batch = await db.event.findMany({
        where: { createdAt: { lt: cutoff } },
        orderBy: { createdAt: "asc" },
        take: batchSize,
        ...(cursor
          ? {
              cursor: { id: cursor },
              skip: 1,
            }
          : {}),
      });

      if (batch.length === 0) break;

      for (const row of batch) {
        pass.write(Buffer.from(rowToCSVLine(row as Record<string, unknown>), "utf8"));
        archivedIds.push(row.id);
      }

      rowsArchived += batch.length;
      cursor = batch[batch.length - 1].id;

      console.log(`[archiver] Archived ${rowsArchived}/${totalEligible} rows...`);
    }

    // Signal end of data to the pipeline
    pass.end();
    await pipelinePromise;

    console.log(`[archiver] Archive file written: ${archiveFile} (${rowsArchived} rows)`);

    // ── Phase 2: Delete archived rows from the relational table ───────────

    let rowsDeleted = 0;

    for (let i = 0; i < archivedIds.length; i += batchSize) {
      const idBatch = archivedIds.slice(i, i + batchSize);
      const deleted = await db.event.deleteMany({
        where: { id: { in: idBatch } },
      });
      rowsDeleted += deleted.count;
      console.log(`[archiver] Deleted ${rowsDeleted}/${rowsArchived} rows from DB...`);
    }

    // ── Phase 3: Validate counts ───────────────────────────────────────────

    if (rowsArchived !== rowsDeleted) {
      console.warn(
        `[archiver] WARNING — row count mismatch: archived=${rowsArchived}, deleted=${rowsDeleted}`
      );
    } else {
      console.log(`[archiver] Counts match — archived and deleted ${rowsArchived} rows.`);
    }

    const durationMs = Date.now() - start;
    console.log(`[archiver] Run complete in ${durationMs}ms.`);

    // Persist run record to ArchiveLog
    await db.archiveLog.create({
      data: {
        cutoffDate: cutoff,
        rowsArchived,
        rowsDeleted,
        archiveFile,
        durationMs,
        status: "success",
        triggeredBy: "cron",
      },
    }).catch((e) => console.warn("[archiver] Could not write ArchiveLog:", e));

    return {
      cutoffDate: cutoffISO,
      rowsArchived,
      rowsDeleted,
      archiveFile,
      durationMs,
      success: true,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[archiver] Run failed: ${message}`);

    const durationMs = Date.now() - start;

    // Remove incomplete archive file to avoid corrupt output
    if (fs.existsSync(archiveFile)) {
      fs.unlinkSync(archiveFile);
      console.warn(`[archiver] Removed incomplete archive file: ${archiveFile}`);
    }

    // Persist failure record to ArchiveLog
    await db.archiveLog.create({
      data: {
        cutoffDate: cutoff,
        rowsArchived: 0,
        rowsDeleted: 0,
        archiveFile: "",
        durationMs,
        status: "failed",
        errorMessage: message,
        triggeredBy: "cron",
      },
    }).catch((e) => console.warn("[archiver] Could not write ArchiveLog failure entry:", e));

    return {
      cutoffDate: cutoffISO,
      rowsArchived: 0,
      rowsDeleted: 0,
      archiveFile: "",
      durationMs,
      success: false,
      error: message,
    };
  }
}
