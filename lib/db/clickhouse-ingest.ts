/**
 * ClickHouse Ingestion Shim — Issue #420 (Option B: Postgres-unified)
 *
 * ARCHITECTURE DECISION
 * ─────────────────────
 * After auditing the full codebase (grep for "clickhouse/ClickHouse"), the
 * only reference to ClickHouse was the now-dead import in
 * `app/api/ingest-historical/route.ts`.  Every other read/write path — search,
 * export, stats, dashboard — talks exclusively to Postgres via Prisma.
 *
 * Introducing a separate ClickHouse store would split the event corpus in two:
 *   • Live-indexed events  → Postgres (readable by all existing endpoints)
 *   • Backfilled events    → ClickHouse (invisible to all existing endpoints)
 *
 * That split violates the acceptance criterion "backfilled data is actually
 * queryable afterward through some real path in the application."
 *
 * We therefore retire ClickHouse as the write target and route all historical
 * backfills through the same Postgres `Event` table.  The @clickhouse/client
 * package listed in package.json is left in place (it may be used in a
 * follow-up analytics layer) but is NOT imported here.
 *
 * PUBLIC CONTRACT
 * ───────────────
 * This module keeps the exact same exported surface that
 * `app/api/ingest-historical/route.ts` originally imported so that file needs
 * only minimal changes:
 *
 *   bufferEvents(events)  — accumulates events in an in-memory buffer and
 *                           auto-flushes to Postgres every AUTO_FLUSH_SIZE rows.
 *   flushEvents()         — drains any remaining buffered events to Postgres.
 *   updateCursorCH(ledger, contractId?)
 *                         — advances the historical IndexerCursor in Postgres.
 *                           Uses id = "historical:<contractId>" when a
 *                           contractId is supplied; falls back to
 *                           "historical:global" for callers that don't track
 *                           per-contract progress.  The live-indexer cursor
 *                           (id = "current") is never touched.
 */

import { batchUpsertEvents } from "./utils";
import { updateHistoricalCursor } from "@/lib/stellar/historical-ingester";
import type { RawEvent } from "@/lib/translator/types";

// ─── Internal buffer ─────────────────────────────────────────────────────────

/**
 * Rows accumulate here until AUTO_FLUSH_SIZE is reached or flushEvents() is
 * called explicitly.  Using a module-level buffer is safe for Next.js API
 * routes because each route invocation runs in its own async context; the
 * buffer is drained (and reset) within a single POST handler lifetime.
 */
let _buffer: RawEvent[] = [];

/** Flush to Postgres automatically once this many rows are buffered. */
const AUTO_FLUSH_SIZE = 10_000;

// ─── Exported API ─────────────────────────────────────────────────────────────

/**
 * Accumulates events in memory and writes them to Postgres in bulk once the
 * internal buffer reaches {@link AUTO_FLUSH_SIZE} rows.
 *
 * Callers that want immediate persistence should follow up with
 * {@link flushEvents}.
 *
 * @param events - Raw events to buffer.  Any extra fields beyond the RawEvent
 *   shape are passed through to `batchUpsertEvents` transparently.
 * @returns Number of rows actually written to Postgres during this call
 *   (0 when the buffer hasn't reached the auto-flush threshold yet).
 */
export async function bufferEvents(
  events: Array<RawEvent & { description?: string; status?: string; blueprintName?: string; eventType?: string }>
): Promise<number> {
  _buffer.push(...events);

  if (_buffer.length >= AUTO_FLUSH_SIZE) {
    return _flushBuffer();
  }

  return 0;
}

/**
 * Writes all buffered events to Postgres and resets the internal buffer.
 *
 * Always call this at the end of an ingestion run to drain any remainder that
 * didn't fill a full AUTO_FLUSH_SIZE batch.
 *
 * @returns Total number of rows upserted in this flush.
 */
export async function flushEvents(): Promise<number> {
  return _flushBuffer();
}

/**
 * Advances the historical backfill cursor in the Postgres `IndexerCursor`
 * table.
 *
 * The cursor key is `"historical:<contractId>"` when `contractId` is supplied,
 * or `"historical:global"` for callers that don't track per-contract progress.
 * This is intentionally distinct from the live-indexer cursor (`"current"`)
 * so the two paths cannot overwrite each other.
 *
 * @param lastLedger  - The last ledger sequence number fully processed.
 * @param contractId  - Optional contract address; scopes the cursor key.
 */
export async function updateCursorCH(
  lastLedger: number,
  contractId = "global"
): Promise<void> {
  await updateHistoricalCursor(contractId, lastLedger);
}

// ─── Private helpers ──────────────────────────────────────────────────────────

async function _flushBuffer(): Promise<number> {
  if (_buffer.length === 0) return 0;

  const toWrite = _buffer.splice(0); // take everything, reset in-place
  const written = await batchUpsertEvents(toWrite);

  console.log(
    `[clickhouse-ingest] Flushed ${written}/${toWrite.length} events to Postgres`
  );

  return written;
/** ClickHouse ingestion helpers (stubbed until analytics pipeline is enabled). */

export async function bufferEvents(_events: unknown[]): Promise<void> {
  // No-op: ClickHouse batching is not configured in this deployment.
}

export async function flushEvents(): Promise<void> {
  // No-op
}

export async function updateCursorCH(_ledger: number): Promise<void> {
  // No-op
}
