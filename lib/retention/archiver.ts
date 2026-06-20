/**
 * Event Archiver
 *
 * Extracts a batch of aged Event rows into a compressed CSV flat-file, then
 * returns a manifest so the caller knows exactly which rows were archived and
 * where the file landed.
 *
 * The CSV schema mirrors lib/export-data.ts (ExportRow) so archived files are
 * compatible with the existing download format and can be replayed / verified
 * with the same tooling.
 *
 * Compression: gzip via Node's built-in zlib — no extra runtime dependencies.
 * Each archive is named:
 *   open-audit-archive-<YYYY-MM-DD>T<HHmmss>Z-<batchIndex>.csv.gz
 */

import * as fs from "fs";
import * as path from "path";
import * as zlib from "zlib";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import type { RetentionPolicy } from "./policy";

/** One row as written to the CSV archive. */
export interface ArchiveRow {
  id: string;
  contractId: string;
  ledger: number;
  timestamp: number;
  txHash: string;
  topics: string;       // JSON-serialised string[]
  data: string;
  description: string | null;
  status: string;
  blueprintName: string | null;
  eventType: string | null;
  createdAt: string;    // ISO-8601
}

/** Result returned after a single archive operation. */
export interface ArchiveResult {
  /** Absolute path to the written .csv.gz file. */
  filePath: string;
  /** Number of rows written into this archive. */
  rowCount: number;
  /** Unix ms timestamps of the oldest and newest event in the batch. */
  oldestTimestamp: number;
  newestTimestamp: number;
  /** Byte size of the compressed file on disk. */
  compressedBytes: number;
}

/** Minimal shape we need from Prisma's Event row. */
export interface PrismaEventRow {
  id: string;
  contractId: string;
  ledger: number;
  timestamp: number;
  txHash: string;
  topics: unknown;   // Prisma returns Json — we'll stringify it
  data: string;
  description: string | null;
  status: string;
  blueprintName: string | null;
  eventType: string | null;
  createdAt: Date;
}

const CSV_HEADERS: Array<keyof ArchiveRow> = [
  "id",
  "contractId",
  "ledger",
  "timestamp",
  "txHash",
  "topics",
  "data",
  "description",
  "status",
  "blueprintName",
  "eventType",
  "createdAt",
];

/** Escapes a CSV field per RFC 4180. */
function escapeCSV(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** Converts a PrismaEventRow to an ArchiveRow. */
function toArchiveRow(event: PrismaEventRow): ArchiveRow {
  return {
    id: event.id,
    contractId: event.contractId,
    ledger: event.ledger,
    timestamp: event.timestamp,
    txHash: event.txHash,
    topics: typeof event.topics === "string" ? event.topics : JSON.stringify(event.topics),
    data: event.data,
    description: event.description,
    status: event.status,
    blueprintName: event.blueprintName,
    eventType: event.eventType,
    createdAt: event.createdAt.toISOString(),
  };
}

/** Serialises rows to a multi-line CSV string (header + data rows). */
function rowsToCSV(rows: ArchiveRow[]): string {
  const header = CSV_HEADERS.join(",");
  const lines = rows.map((row) =>
    CSV_HEADERS.map((col) => escapeCSV(row[col])).join(",")
  );
  return [header, ...lines].join("\r\n");
}

/**
 * Writes `events` to a gzip-compressed CSV inside `policy.archiveDir`.
 *
 * @param events      Prisma Event rows to archive (already fetched by caller).
 * @param batchIndex  Monotonic counter for the filename — avoids collisions when
 *                    multiple batches run within the same second.
 * @param policy      Retention policy (used for archiveDir and dryRun flag).
 * @returns           ArchiveResult manifest, or null when dryRun is true.
 */
export async function archiveBatch(
  events: PrismaEventRow[],
  batchIndex: number,
  policy: RetentionPolicy
): Promise<ArchiveResult | null> {
  if (events.length === 0) {
    return { filePath: "", rowCount: 0, oldestTimestamp: 0, newestTimestamp: 0, compressedBytes: 0 };
  }

  const rows = events.map(toArchiveRow);
  const csv = rowsToCSV(rows);

  const timestamps = rows.map((r) => r.timestamp);
  const oldestTimestamp = Math.min(...timestamps);
  const newestTimestamp = Math.max(...timestamps);

  // Build filename: open-audit-archive-2024-06-17T020001Z-0.csv.gz
  const now = new Date();
  const datePart = now.toISOString().replace(/[:.]/g, "").slice(0, 15) + "Z";
  const filename = `open-audit-archive-${datePart}-${batchIndex}.csv.gz`;

  if (policy.dryRun) {
    console.log(
      `[retention/archiver] DRY RUN — would write ${rows.length} rows to ${filename}`
    );
    return null;
  }

  // Ensure the archive directory exists
  const absDir = path.resolve(policy.archiveDir);
  fs.mkdirSync(absDir, { recursive: true });
  const filePath = path.join(absDir, filename);

  // Stream CSV → gzip → file
  const readable = Readable.from([Buffer.from(csv, "utf8")]);
  const gzip = zlib.createGzip({ level: zlib.constants.Z_BEST_COMPRESSION });
  const dest = fs.createWriteStream(filePath);

  await pipeline(readable, gzip, dest);

  const { size: compressedBytes } = fs.statSync(filePath);

  console.log(
    `[retention/archiver] Archived ${rows.length} rows → ${filePath} (${compressedBytes} bytes)`
  );

  return { filePath, rowCount: rows.length, oldestTimestamp, newestTimestamp, compressedBytes };
}
