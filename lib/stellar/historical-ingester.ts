import type { StellarNetworkConfig } from "./client";

export interface HistoricalIngestResult {
  events: unknown[];
  eventCount: number;
  chunkStart: number;
  chunkEnd: number;
}

export interface HistoricalIngestOptions {
  networkConfig: StellarNetworkConfig;
  contractId: string;
  startSequence: number;
  endSequence: number;
  chunkSize: number;
  onChunkComplete?: (result: HistoricalIngestResult) => void | Promise<void>;
  onComplete?: (totalEvents: number, totalChunks: number) => void | Promise<void>;
}

/**
 * Backfills contract events for a historical ledger range.
 * Placeholder implementation until ClickHouse/historical pipeline is wired.
 */
export async function ingestHistoricalRange(options: HistoricalIngestOptions): Promise<void> {
  const { startSequence, endSequence, chunkSize, onChunkComplete, onComplete } = options;
  let totalEvents = 0;
  let totalChunks = 0;

  for (let cursor = startSequence; cursor <= endSequence; cursor += chunkSize) {
    const chunkEnd = Math.min(cursor + chunkSize - 1, endSequence);
    const result: HistoricalIngestResult = {
      events: [],
      eventCount: 0,
      chunkStart: cursor,
      chunkEnd,
    };

    await onChunkComplete?.(result);
    totalEvents += result.eventCount;
    totalChunks++;
  }

  await onComplete?.(totalEvents, totalChunks);
}
