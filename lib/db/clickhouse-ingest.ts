/**
 * ClickHouse ingestion pipeline.
 *
 * Key design decisions:
 *  - Rows are buffered in memory and flushed when the buffer reaches
 *    BATCH_SIZE (10 000) or when flushEvents() is called explicitly.
 *  - ClickHouse async_insert is enabled on the client so individual
 *    insert calls return immediately; the server batches the writes
 *    internally on top of our own batching.
 *  - ReplacingMergeTree deduplicates on event_id in the background,
 *    so re-ingesting the same ledger range is safe.
 */

import { getClickHouseClient } from "./clickhouse";
import type { RawEvent } from "@/lib/stellar/types";

export const BATCH_SIZE = 10_000;

export interface IngestableEvent extends RawEvent {
  description?: string;
  status?: string;
  blueprintName?: string;
  eventType?: string;
}

/** In-memory buffer – drained every BATCH_SIZE rows or on explicit flush. */
const buffer: IngestableEvent[] = [];

/**
 * Converts a RawEvent into a flat ClickHouse row.
 * topics is serialised to JSON; timestamp (Unix seconds) → DateTime.
 */
function toRow(e: IngestableEvent) {
  return {
    event_id: e.id,
    contract_id: e.contractId,
    ledger: e.ledger,
    event_timestamp: new Date(e.timestamp * 1000).toISOString().replace("T", " ").replace("Z", ""),
    tx_hash: e.txHash,
    topics: JSON.stringify(e.topics ?? []),
    data: e.data ?? "",
    description: e.description ?? null,
    status: e.status ?? "cryptic",
    blueprint_name: e.blueprintName ?? null,
    event_type: e.eventType ?? "",
    rpc_verified: 0,
  };
}

/**
 * Flush a specific batch of rows to ClickHouse.
 */
async function flush(rows: IngestableEvent[]): Promise<void> {
  if (rows.length === 0) return;
  const client = getClickHouseClient();
  await client.insert({
    table: "events",
    values: rows.map(toRow),
    format: "JSONEachRow",
  });
}

/**
 * Add events to the buffer and auto-flush when BATCH_SIZE is reached.
 * Call flushEvents() after the last batch to drain any remainder.
 */
export async function bufferEvents(events: IngestableEvent[]): Promise<void> {
  buffer.push(...events);
  while (buffer.length >= BATCH_SIZE) {
    const batch = buffer.splice(0, BATCH_SIZE);
    await flush(batch);
  }
}

/**
 * Drain whatever remains in the buffer (call at end of an ingestion run).
 */
export async function flushEvents(): Promise<void> {
  if (buffer.length === 0) return;
  const remaining = buffer.splice(0, buffer.length);
  await flush(remaining);
}

/**
 * Convenience wrapper – behaves like the existing batchUpsertEvents in
 * lib/db/utils.ts but targets ClickHouse and processes 10 k rows per flush.
 */
export async function batchInsertEvents(events: IngestableEvent[]): Promise<number> {
  let inserted = 0;
  for (let i = 0; i < events.length; i += BATCH_SIZE) {
    const batch = events.slice(i, i + BATCH_SIZE);
    await flush(batch);
    inserted += batch.length;
  }
  return inserted;
}

// ----------------------------------------------------------------
// Cursor helpers (ClickHouse-backed, mirrors lib/db/utils.ts API)
// ----------------------------------------------------------------

export async function updateCursorCH(lastLedger: number): Promise<void> {
  const client = getClickHouseClient();
  await client.insert({
    table: "indexer_cursor",
    values: [{ id: "current", last_ledger: lastLedger, last_processed: new Date().toISOString().replace("T", " ").replace("Z", "") }],
    format: "JSONEachRow",
  });
}

export async function getCursorCH(): Promise<number> {
  const client = getClickHouseClient();
  const result = await client.query({
    query: "SELECT last_ledger FROM indexer_cursor FINAL WHERE id = 'current' LIMIT 1",
    format: "JSONEachRow",
  });
  const rows = await result.json<{ last_ledger: number }[]>();
  return rows[0]?.last_ledger ?? 0;
}

// ----------------------------------------------------------------
// Analytics helpers (read from materialized views for < 50 ms P99)
// ----------------------------------------------------------------

export interface DailyVolume {
  contract_id: string;
  event_date: string;
  event_count: number;
  unique_tx: number;
}

/**
 * Returns daily event counts for a contract over the last `days` days.
 * Reads from the pre-aggregated materialized view – sub-50 ms even at scale.
 */
export async function getDailyVolume(contractId: string, days = 30): Promise<DailyVolume[]> {
  const client = getClickHouseClient();
  const result = await client.query({
    query: `
      SELECT
        contract_id,
        event_date,
        countMerge(event_count)  AS event_count,
        uniqMerge(unique_tx)     AS unique_tx
      FROM mv_daily_contract_volume_state
      WHERE contract_id = {contractId: String}
        AND event_date >= today() - {days: UInt32}
      GROUP BY contract_id, event_date
      ORDER BY event_date
    `,
    query_params: { contractId, days },
    format: "JSONEachRow",
  });
  return result.json<DailyVolume[]>();
}

export interface EventTypeTotals {
  contract_id: string;
  event_type: string;
  total: number;
}

/**
 * Returns per-event-type totals for a contract from the materialized view.
 */
export async function getEventTypeTotals(contractId: string): Promise<EventTypeTotals[]> {
  const client = getClickHouseClient();
  const result = await client.query({
    query: `
      SELECT
        contract_id,
        event_type,
        countMerge(total) AS total
      FROM mv_event_type_totals_state
      WHERE contract_id = {contractId: String}
      GROUP BY contract_id, event_type
    `,
    query_params: { contractId },
    format: "JSONEachRow",
  });
  return result.json<EventTypeTotals[]>();
}
