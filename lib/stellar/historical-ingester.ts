/**
 * Historical Ledger Range Ingestion Tool
 *
 * This module provides functionality to backfill contract events from a specified
 * historical ledger range. It implements chunking to avoid RPC node memory/timeout limits.
 */

import { SorobanRpc } from "stellar-sdk";
import type { StellarNetworkConfig } from "./client";
import { fetchEventsWithRetry, DEFAULT_RETRY_CONFIG, type IndexerRetryConfig } from "./indexer";

/** Configuration for historical ingestion. */
export interface HistoricalIngestionConfig {
  /** Network configuration. */
  networkConfig: StellarNetworkConfig;
  /** Contract ID to fetch events for. */
  contractId: string;
  /** Starting ledger sequence number. */
  startSequence: number;
  /** Ending ledger sequence number (inclusive). */
  endSequence: number;
  /** Chunk size - number of ledgers to fetch per request. */
  chunkSize?: number;
  /** Retry configuration. */
  retryConfig?: IndexerRetryConfig;
}

/** Result of a chunk ingestion. */
export interface ChunkResult {
  chunkIndex: number;
  startSequence: number;
  endSequence: number;
  eventCount: number;
  events: SorobanRpc.Api.EventResponse[];
}

/** Callback for chunk completion. */
export type OnChunkComplete = (result: ChunkResult) => void | Promise<void>;

/** Callback for completion. */
export type OnComplete = (totalEvents: number, totalChunks: number) => void | Promise<void>;

/** Callback for errors. */
export type OnError = (error: Error, chunkIndex: number) => void;

/** Options for historical ingestion. */
export interface HistoricalIngestionOptions extends HistoricalIngestionConfig {
  /** Callback when a chunk is completed. */
  onChunkComplete?: OnChunkComplete;
  /** Callback when all chunks are completed. */
  onComplete?: OnComplete;
  /** Callback for errors. */
  onError?: OnError;
}

/** Default chunk size (1000 ledgers per request). */
export const DEFAULT_CHUNK_SIZE = 1000;

/**
 * Validates historical ingestion parameters.
 * @throws Error if parameters are invalid.
 */
function validateParameters(config: HistoricalIngestionConfig): void {
  if (!config.contractId || config.contractId.trim().length === 0) {
    throw new Error("contractId is required and cannot be empty");
  }
  if (config.startSequence < 1) {
    throw new Error("startSequence must be >= 1");
  }
  if (config.endSequence < config.startSequence) {
    throw new Error("endSequence must be >= startSequence");
  }
}

/**
 * Ingests contract events from a historical ledger range.
 *
 * This function fetches events in chunks to avoid hitting RPC node limits.
 * The chunk size can be tuned based on your RPC node's capacity.
 *
 * @example
 * ```typescript
 * const ingester = await ingestHistoricalRange({
 *   networkConfig: TESTNET_CONFIG,
 *   contractId: "CABC...",
 *   startSequence: 1000,
 *   endSequence: 5000,
 *   chunkSize: 1000,
 *   onChunkComplete: async (result) => {
 *     console.log(`Chunk ${result.chunkIndex}: fetched ${result.eventCount} events`);
 *     // Save to database...
 *   },
 *   onComplete: async (totalEvents, totalChunks) => {
 *     console.log(`Completed: ${totalEvents} events in ${totalChunks} chunks`);
 *   },
 *   onError: (error, chunkIndex) => {
 *     console.error(`Error in chunk ${chunkIndex}: ${error.message}`);
 *   },
 * });
 * ```
 */
export async function ingestHistoricalRange(
  options: HistoricalIngestionOptions
): Promise<void> {
  const {
    networkConfig,
    contractId,
    startSequence,
    endSequence,
    chunkSize = DEFAULT_CHUNK_SIZE,
    retryConfig = DEFAULT_RETRY_CONFIG,
    onChunkComplete,
    onComplete,
    onError,
  } = options;

  // Validate parameters
  validateParameters({
    networkConfig,
    contractId,
    startSequence,
    endSequence,
    chunkSize,
    retryConfig,
  });

  // Initialize Soroban RPC server
  const server = new SorobanRpc.Server(networkConfig.sorobanRpcUrl);

  // Calculate total chunks
  const totalLedgers = endSequence - startSequence + 1;
  const totalChunks = Math.ceil(totalLedgers / chunkSize);

  console.log(
    `[historical-ingester] Starting ingestion: ${contractId} from ledger ${startSequence} to ${endSequence}`
  );
  console.log(`[historical-ingester] Total ledgers: ${totalLedgers}, chunks: ${totalChunks}`);

  let totalEvents = 0;

  // Process each chunk
  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
    const chunkStart = startSequence + chunkIndex * chunkSize;
    const chunkEnd = Math.min(chunkStart + chunkSize - 1, endSequence);

    try {
      console.log(
        `[historical-ingester] Fetching chunk ${chunkIndex + 1}/${totalChunks}: ledgers ${chunkStart}-${chunkEnd}`
      );

      // Fetch events for this chunk with retry logic
      const response = await fetchEventsWithRetry(
        server,
        [contractId],
        chunkStart,
        retryConfig
      );

      const events = response.events || [];
      totalEvents += events.length;

      // Create chunk result
      const chunkResult: ChunkResult = {
        chunkIndex,
        startSequence: chunkStart,
        endSequence: chunkEnd,
        eventCount: events.length,
        events,
      };

      // Invoke chunk callback
      if (onChunkComplete) {
        await onChunkComplete(chunkResult);
      }

      console.log(
        `[historical-ingester] Chunk ${chunkIndex + 1}/${totalChunks}: fetched ${events.length} events`
      );
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      // Invoke error callback
      if (onError) {
        onError(err, chunkIndex);
      } else {
        console.error(`[historical-ingester] Error in chunk ${chunkIndex}: ${err.message}`);
      }

      // Stop processing on error
      throw err;
    }
  }

  // Invoke completion callback
  if (onComplete) {
    await onComplete(totalEvents, totalChunks);
  }

  console.log(
    `[historical-ingester] Completed: ${totalEvents} total events across ${totalChunks} chunks`
  );
}
