/**
 * Historical Ledger Range Ingester
 *
 * Fetches and backfills Soroban contract events from a bounded ledger range
 * into the Postgres Event table — the same store used by the live indexer.
 *
 * Architecture decision (Issue #420 — Option B):
 *   All events, live *and* historical, land in the single Postgres `Event`
 *   table managed by Prisma.  ClickHouse is retired for this use-case.
 *   This means every existing read path (search, export, stats, dashboard)
 *   automatically sees backfilled data without any schema changes.
 *
 * Cursor strategy:
 *   The live indexer stores its progress under IndexerCursor id = "current".
 *   Historical backfills store per-contract progress under
 *   IndexerCursor id = "historical:<contractId>" so the two paths never
 *   overwrite each other.
 */

import { SorobanRpc } from "stellar-sdk";
import { fetchEventsWithRetry, DEFAULT_RETRY_CONFIG, type IndexerRetryConfig } from "./indexer";
import { eventResponseToRawEvent } from "./events";
import { translateAndPersistBatch } from "@/lib/translator/persistence";
import { db } from "@/lib/db/client";
import type { StellarNetworkConfig } from "./client";
import type { RawEvent } from "@/lib/translator/types";

// ─── Public types ────────────────────────────────────────────────────────────

/** Summary returned after processing each ledger chunk. */
export interface ChunkResult {
  /** Ledger sequence the chunk started at (inclusive). */
  startLedger: number;
  /** Ledger sequence the chunk ended at (inclusive). */
  endLedger: number;
  /** Zero-indexed chunk position within the full range. */
  chunkIndex: number;
  /** Raw events fetched from the RPC for this chunk. */
  events: RawEvent[];
  /** Number of events successfully translated and upserted. */
  eventCount: number;
  /** Number of events that ended up in the dead-letter queue. */
  failedCount: number;
}

/** Callback invoked after each chunk is fully processed. */
export type ChunkCompleteHandler = (result: ChunkResult) => void | Promise<void>;

/** Callback invoked once the entire range has been processed. */
export type IngestionCompleteHandler = (
  totalEvents: number,
  totalChunks: number
) => void | Promise<void>;

/** Parameters accepted by {@link ingestHistoricalRange}. */
export interface HistoricalIngestionOptions {
  /** Active network configuration (RPC URL, passphrase, …). */
  networkConfig: StellarNetworkConfig;
  /** Soroban contract address to backfill events for. */
  contractId: string;
  /** First ledger to include (inclusive). */
  startSequence: number;
  /** Last ledger to include (inclusive). */
  endSequence: number;
  /**
   * How many ledgers to request per RPC call.
   * Smaller values reduce per-request latency; larger values reduce round-trips.
   * @default 1000
   */
  chunkSize?: number;
  /** Retry / back-off config forwarded to {@link fetchEventsWithRetry}. */
  retryConfig?: IndexerRetryConfig;
  /** Called after each chunk is persisted. */
  onChunkComplete?: ChunkCompleteHandler;
  /** Called once the entire range is done. */
  onComplete?: IngestionCompleteHandler;
}

/** Summary returned by {@link ingestHistoricalRange}. */
export interface IngestionResult {
  contractId: string;
  startSequence: number;
  endSequence: number;
  totalEvents: number;
  totalChunks: number;
  failedEvents: number;
}

// ─── Cursor helpers (historical-specific) ────────────────────────────────────

/**
 * Returns the IndexerCursor id used by historical backfills for a given
 * contract.  Never collides with the live indexer's "current" cursor.
 */
export function historicalCursorId(contractId: string): string {
  return `historical:${contractId}`;
}

/**
 * Persists the last-processed ledger for a historical backfill run.
 * Uses an id distinct from the live-indexer cursor so the two never conflict.
 */
export async function updateHistoricalCursor(
  contractId: string,
  lastLedger: number
): Promise<void> {
  const id = historicalCursorId(contractId);
  await db.indexerCursor.upsert({
    where: { id },
    update: { lastLedger, lastProcessed: new Date() },
    create: { id, lastLedger, lastProcessed: new Date() },
  });
}

/**
 * Returns the last ledger saved by a previous historical backfill for this
 * contract, or 0 if no prior run exists.
 */
export async function getHistoricalCursor(contractId: string): Promise<number> {
  const cursor = await db.indexerCursor.findUnique({
    where: { id: historicalCursorId(contractId) },
  });
  return cursor?.lastLedger ?? 0;
}

// ─── Core ingestion logic ─────────────────────────────────────────────────────

/**
 * Fetches and persists all Soroban contract events in the given ledger range,
 * processing them in chunks to keep per-request payloads manageable.
 *
 * Each chunk goes through the full translate-and-persist pipeline
 * ({@link translateAndPersistBatch}) so every event is either written to the
 * Postgres `Event` table or captured in `DeadLetterEvent` for later triage —
 * exactly the same guarantee the live indexer provides.
 *
 * The historical cursor is advanced after **each chunk** so a partial run can
 * resume from where it left off if retried.
 *
 * @example
 * ```ts
 * const result = await ingestHistoricalRange({
 *   networkConfig: getNetworkConfig(),
 *   contractId: "CABC...",
 *   startSequence: 1_000_000,
 *   endSequence:   1_050_000,
 *   chunkSize: 1_000,
 *   onChunkComplete: ({ chunkIndex, eventCount }) =>
 *     console.log(`Chunk ${chunkIndex}: ${eventCount} events`),
 * });
 * console.log(`Done — ${result.totalEvents} events ingested`);
 * ```
 */
export async function ingestHistoricalRange(
  options: HistoricalIngestionOptions
): Promise<IngestionResult> {
  const {
    networkConfig,
    contractId,
    startSequence,
    endSequence,
    chunkSize = 1_000,
    retryConfig = DEFAULT_RETRY_CONFIG,
    onChunkComplete,
    onComplete,
  } = options;

  const server = new SorobanRpc.Server(networkConfig.sorobanRpcUrl);

  let totalEvents = 0;
  let totalFailed = 0;
  let chunkIndex = 0;

  // Walk the requested range in fixed-size ledger windows.
  for (
    let chunkStart = startSequence;
    chunkStart <= endSequence;
    chunkStart += chunkSize
  ) {
    const chunkEnd = Math.min(chunkStart + chunkSize - 1, endSequence);

    console.log(
      `[historical-ingester] Chunk ${chunkIndex}: ledgers ${chunkStart}–${chunkEnd} ` +
        `(contract ${contractId})`
    );

    // Fetch this window from the Soroban RPC with retry / back-off.
    const response = await fetchEventsWithRetry(
      server,
      [contractId],
      chunkStart,
      chunkEnd,
      retryConfig,
      networkConfig.sorobanRpcUrl
    );

    const rpcEvents = response.events ?? [];

    // Normalise RPC responses into the canonical RawEvent shape.
    const rawEvents: RawEvent[] = rpcEvents.map((e) =>
      eventResponseToRawEvent(e, contractId)
    );

    // Translate + upsert (idempotent) into the shared Postgres Event table.
    // Events that cannot be translated land in DeadLetterEvent automatically.
    const { successful, failed } = await translateAndPersistBatch(rawEvents);

    totalEvents += successful;
    totalFailed += failed;

    // Advance the per-contract historical cursor so a retry can resume.
    await updateHistoricalCursor(contractId, chunkEnd);

    const chunkResult: ChunkResult = {
      startLedger: chunkStart,
      endLedger: chunkEnd,
      chunkIndex,
      events: rawEvents,
      eventCount: successful,
      failedCount: failed,
    };

    if (onChunkComplete) {
      await onChunkComplete(chunkResult);
    }

    chunkIndex++;
  }

  if (onComplete) {
    await onComplete(totalEvents, chunkIndex);
  }

  console.log(
    `[historical-ingester] Completed: ${totalEvents} events ingested, ` +
      `${totalFailed} dead-lettered, ${chunkIndex} chunks processed ` +
      `(ledgers ${startSequence}–${endSequence}, contract ${contractId})`
  );

  return {
    contractId,
    startSequence,
    endSequence,
    totalEvents,
    totalChunks: chunkIndex,
    failedEvents: totalFailed,
  };
}
