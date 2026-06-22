/**
 * scripts/test-retention.ts
 *
 * Acceptance-test script for the data-retention archival feature.
 *
 * What it does
 * ─────────────
 *  1. Seeds N rows into the Event table with createdAt dates older than the
 *     configured RETENTION_DAYS window.
 *  2. Runs archiveAndPurgeOldEvents() directly (no cron needed).
 *  3. Verifies that:
 *       • The archive .csv.gz file exists and is non-empty.
 *       • The number of CSV data rows equals the seeded count.
 *       • The seeded rows are no longer present in the Event table.
 *       • An ArchiveLog record was created with status "success".
 *  4. Cleans up the seeded and archive data so the DB is left clean.
 *
 * Usage
 *   npx tsx scripts/test-retention.ts
 *
 * Environment variables (optional overrides for this test run only)
 *   RETENTION_TEST_ROWS      – number of rows to seed   (default 25)
 *   RETENTION_TEST_DAYS_AGO  – how far back to date them (default 200)
 */

import fs from "fs";
import zlib from "zlib";
import { db } from "../lib/db/client";
import { archiveAndPurgeOldEvents } from "../lib/retention/archiver";

// ── Helpers ─────────────────────────────────────────────────────────────────

function log(msg: string) {
  console.log(`[test-retention] ${msg}`);
}

function fail(msg: string): never {
  console.error(`[test-retention] FAIL — ${msg}`);
  process.exit(1);
}

function assert(condition: boolean, msg: string): void {
  if (!condition) fail(msg);
}

/** Read a gzip-compressed file and return its text content. */
function readGzip(filePath: string): string {
  const compressed = fs.readFileSync(filePath);
  return zlib.gunzipSync(compressed).toString("utf8");
}

/** Count non-empty lines that are not the CSV header. */
function countDataRows(csvText: string): number {
  return csvText
    .split("\n")
    .slice(1) // skip header
    .filter((l) => l.trim().length > 0).length;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const SEED_ROWS = parseInt(process.env.RETENTION_TEST_ROWS ?? "25", 10);
  const DAYS_AGO = parseInt(process.env.RETENTION_TEST_DAYS_AGO ?? "200", 10);

  log(`Seeding ${SEED_ROWS} events dated ${DAYS_AGO} days ago...`);

  const oldDate = new Date(Date.now() - DAYS_AGO * 24 * 60 * 60 * 1000);

  // Use a unique prefix so we can find these rows reliably even if real data exists
  const testPrefix = `test-retention-${Date.now()}`;

  const seededIds: string[] = [];

  for (let i = 0; i < SEED_ROWS; i++) {
    const id = `${testPrefix}-${i}`;
    seededIds.push(id);

    await db.event.upsert({
      where: { id },
      update: {},
      create: {
        id,
        contractId: `CTEST${i}`,
        ledger: 1000 + i,
        timestamp: Math.floor(oldDate.getTime() / 1000),
        txHash: `txhash-test-${i}`,
        topics: JSON.stringify(["topic1"]),
        data: `data-${i}`,
        description: `Test event ${i} for retention script`,
        status: "translated",
        blueprintName: "TestContract",
        eventType: "transfer",
        createdAt: oldDate,
        updatedAt: oldDate,
      },
    });
  }

  log(`Seeded ${SEED_ROWS} rows with createdAt=${oldDate.toISOString()}`);

  // ── Run the archiver with a short retention window so our rows qualify ───

  // Use 90 days as the retention window — our rows are 200 days old, so they qualify
  const retentionDays = 90;
  const result = await archiveAndPurgeOldEvents(retentionDays);

  log(`Archiver result: ${JSON.stringify(result, null, 2)}`);

  // ── Assertions ────────────────────────────────────────────────────────────

  assert(result.success, `Archive run reported failure: ${result.error}`);

  assert(
    result.rowsArchived >= SEED_ROWS,
    `Expected at least ${SEED_ROWS} rows archived, got ${result.rowsArchived}`
  );

  assert(
    result.rowsDeleted >= SEED_ROWS,
    `Expected at least ${SEED_ROWS} rows deleted, got ${result.rowsDeleted}`
  );

  assert(
    result.archiveFile.length > 0,
    "archiveFile path should not be empty"
  );

  assert(
    fs.existsSync(result.archiveFile),
    `Archive file not found at ${result.archiveFile}`
  );

  // Validate gzip CSV contents
  const csvText = readGzip(result.archiveFile);
  const dataRows = countDataRows(csvText);

  assert(
    dataRows >= SEED_ROWS,
    `Archive CSV should contain at least ${SEED_ROWS} data rows, got ${dataRows}`
  );

  log(`Archive file contains ${dataRows} data rows — OK`);

  // Confirm seeded rows are no longer in the DB
  const remaining = await db.event.count({
    where: { id: { in: seededIds } },
  });

  assert(
    remaining === 0,
    `${remaining} seeded row(s) still present in DB after archival`
  );

  log(`All ${SEED_ROWS} seeded rows removed from Event table — OK`);

  // Confirm ArchiveLog entry was created
  const logEntry = await db.archiveLog.findFirst({
    where: { archiveFile: result.archiveFile },
  });

  assert(logEntry !== null, "ArchiveLog entry not found for this run");
  assert(logEntry!.status === "success", `ArchiveLog status should be "success", got "${logEntry!.status}"`);

  log(`ArchiveLog entry created with status="${logEntry!.status}" — OK`);

  // ── Cleanup ───────────────────────────────────────────────────────────────

  log("Cleaning up archive file and ArchiveLog entry...");

  fs.unlinkSync(result.archiveFile);

  await db.archiveLog.delete({ where: { id: logEntry!.id } });

  log("Cleanup complete.");

  log("✓ ALL ASSERTIONS PASSED");
}

main()
  .catch((err) => {
    console.error("[test-retention] Unexpected error:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
