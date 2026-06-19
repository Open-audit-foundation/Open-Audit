/**
 * Stellar Event Indexer with Rate Limit Handling
 *
 * This module implements a robust event indexer that continuously polls
 * the Stellar RPC getEvents endpoint with exponential backoff retry logic
 * to handle HTTP 429 (Too Many Requests) errors gracefully.
 */

import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname } from "path";
import { SorobanRpc, Horizon, xdr, scValToNative, StrKey } from "stellar-sdk";
import { initRedis, getCachedEvents, setCachedEvents, isRedisEnabled } from "../cache/redisCache";
import type { StellarNetworkConfig } from "./client";
import type { RawEvent } from "../translator/types";

/** Configuration for the indexer retry mechanism. */
export interface IndexerRetryConfig {
  /** Initial delay in milliseconds before the first retry. */
  initialDelayMs: number;
  /** Maximum delay in milliseconds between retries. */
  maxDelayMs: number;
  /** Maximum number of retry attempts before giving up. */
  maxRetries: number;
  /** Multiplier for exponential backoff. */
  backoffMultiplier: number;
}

/** Default retry configuration with exponential backoff. */
export const DEFAULT_RETRY_CONFIG: IndexerRetryConfig = {
  initialDelayMs: 1000, // Start with 1 second
  maxDelayMs: 32000, // Cap at 32 seconds
  maxRetries: 10,
  backoffMultiplier: 2, // Double the delay each time
};

/** Represents the state of the indexer cursor. */
export interface IndexerCursor {
  /** The last successfully indexed ledger number. */
  lastLedger: number;
  /** The cursor string for pagination (if provided by RPC). */
  paginationCursor?: string;
}

/** Callback function invoked when new events are successfully fetched. */
export type EventBatchHandler = (
  events: SorobanRpc.Api.EventResponse[],
  cursor: IndexerCursor
) => void | Promise<void>;

/** Callback function invoked when an error occurs. */
export type ErrorHandler = (error: Error, willRetry: boolean) => void;

/** Durable cursor state saved after successful ingestion. */
export interface IngestionState extends IndexerCursor {
  /** Last Horizon/SSE paging token, when available. */
  pagingToken?: string;
  /** Last update timestamp in ISO-8601 format. */
  updatedAt: string;
}

/** Persistence adapter for ingestion cursor state. */
export interface IngestionStateStore {
  load: () => Promise<IngestionState | null>;
  save: (state: IngestionState) => Promise<void>;
}

/** In-memory state store useful for tests or ephemeral deployments. */
export function createMemoryIngestionStateStore(
  initialState: IngestionState | null = null
): IngestionStateStore {
  let state = initialState;

  return {
    load: async function () {
      return state ? { ...state } : null;
    },
    save: async function (nextState) {
      state = { ...nextState };
    },
  };
}

/** File-backed state store for lightweight durable cursor persistence. */
export function createFileIngestionStateStore(filePath: string): IngestionStateStore {
  return {
    load: async function () {
      try {
        return JSON.parse(await readFile(filePath, "utf8")) as IngestionState;
      } catch (error: unknown) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
          return null;
        }
        throw error;
      }
    },
    save: async function (state) {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    },
  };
}

/**
 * Sleep utility for implementing delays.
 */
async function sleep(ms: number): Promise<void> {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

/**
 * Calculate the next retry delay using exponential backoff.
 * Exported for testing purposes.
 */
export function calculateRetryDelay(attemptNumber: number, config: IndexerRetryConfig): number {
  const delay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attemptNumber);
  return Math.min(delay, config.maxDelayMs);
}

/**
 * Checks if an error is an HTTP 429 (Too Many Requests) error.
 */
function isRetryableRpcError(error: unknown): boolean {
  if (error instanceof Error) {
    // Check for common patterns in stellar-sdk errors
    const message = error.message.toLowerCase();
    return (
      message.includes("429") ||
      message.includes("too many requests") ||
      message.includes("rate limit") ||
      message.includes("timeout") ||
      message.includes("timed out") ||
      message.includes("network") ||
      message.includes("econnreset") ||
      message.includes("econnrefused") ||
      message.includes("fetch failed")
    );
  }
  return false;
}

/**
 * Fetches events from Stellar RPC with automatic retry on rate limit errors.
 *
 * This function implements exponential backoff retry logic to handle HTTP 429
 * errors gracefully. The cursor is only updated after a successful fetch to
 * prevent skipping un-indexed events.
 *
 * @param server - The Soroban RPC server instance
 * @param contractIds - Array of contract IDs to filter events
 * @param startLedger - The ledger number to start fetching from
 * @param retryConfig - Configuration for retry behavior
 * @returns The events response from the RPC server
 * @throws Error if all retry attempts are exhausted
 */
export async function fetchEventsWithRetry(
  server: SorobanRpc.Server,
  contractIds: string[],
  startLedger: number,
  retryConfig: IndexerRetryConfig = DEFAULT_RETRY_CONFIG,
  sorobanRpcUrl?: string
): Promise<SorobanRpc.Api.GetEventsResponse> {
  if (isRedisEnabled() && sorobanRpcUrl) {
    initRedis();
    const cached = await getCachedEvents(sorobanRpcUrl, contractIds, startLedger);
    if (cached) {
      // Return cached object as if it came from RPC
      return cached as SorobanRpc.Api.GetEventsResponse;
    }
  }
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
    try {
      // Attempt to fetch events
      const response = await server.getEvents({
        startLedger,
        filters: [
          {
            type: "contract",
            contractIds,
          },
        ],
      });

      if (isRedisEnabled() && sorobanRpcUrl) {
        try {
          await setCachedEvents(sorobanRpcUrl, contractIds, startLedger, response);
        } catch (err) {
          console.warn("[indexer] Failed to set cache:", err);
        }
      }
      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if this is a rate limit error
      const isRateLimit = isRetryableRpcError(error);

      // If it's not a rate limit error, throw immediately
      if (!isRateLimit) {
        throw lastError;
      }

      // If we've exhausted all retries, throw
      if (attempt >= retryConfig.maxRetries) {
        throw new Error(
          `Failed to fetch events after ${retryConfig.maxRetries} retries due to rate limiting: ${lastError.message}`
        );
      }

      // Calculate backoff delay
      const delayMs = calculateRetryDelay(attempt, retryConfig);

      console.warn(
        `[indexer] Rate limit hit (429). Retrying in ${delayMs}ms (attempt ${attempt + 1}/${retryConfig.maxRetries})...`
      );

      // Wait before retrying
      await sleep(delayMs);
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError || new Error("Unknown error during event fetch");
}

/**
 * Options for starting the event indexer.
 */
export interface IndexerOptions {
  /** Network configuration. */
  networkConfig: StellarNetworkConfig;
  /** Contract IDs to monitor. */
  contractIds: string[];
  /** Starting ledger number. */
  startLedger: number;
  /** Polling interval in milliseconds. */
  pollIntervalMs: number;
  /** Retry configuration. */
  retryConfig?: IndexerRetryConfig;
  /** Optional durable state store used to resume after restarts. */
  stateStore?: IngestionStateStore;
  /** Callback for handling event batches. */
  onEvents: EventBatchHandler;
  /** Callback for handling errors. */
  onError?: ErrorHandler;
}

/**
 * Controls for managing a running indexer instance.
 */
export interface IndexerControls {
  /** Stops the indexer. */
  stop: () => void;
  /** Gets the current cursor state. */
  getCursor: () => IndexerCursor;
}

/**
 * Starts a continuous event indexer that polls the Stellar RPC endpoint.
 *
 * The indexer implements the following safety mechanisms:
 * - Exponential backoff retry on HTTP 429 errors
 * - Cursor-based pagination to prevent skipping events
 * - Only updates cursor after successful fetch
 * - Graceful error handling with callbacks
 *
 * @example
 * ```typescript
 * const indexer = startEventIndexer({
 *   networkConfig: TESTNET_CONFIG,
 *   contractIds: ["CABC..."],
 *   startLedger: 1000,
 *   pollIntervalMs: 5000,
 *   onEvents: async (events, cursor) => {
 *     console.log(`Received ${events.length} events`);
 *     // Process events...
 *   },
 *   onError: (error, willRetry) => {
 *     console.error(`Indexer error: ${error.message}`);
 *   },
 * });
 *
 * // Later, to stop:
 * indexer.stop();
 * ```
 */
export function startEventIndexer(options: IndexerOptions): IndexerControls {
  const {
    networkConfig,
    contractIds,
    startLedger,
    pollIntervalMs,
    retryConfig = DEFAULT_RETRY_CONFIG,
    stateStore,
    onEvents,
    onError,
  } = options;

  // Initialize the Soroban RPC server
  const server = new SorobanRpc.Server(networkConfig.sorobanRpcUrl);

  // Initialize cursor state
  let cursor: IndexerCursor = {
    lastLedger: startLedger,
  };

  // Control flag for stopping the indexer
  let isRunning = true;

  /**
   * Main polling loop.
   */
  async function poll(): Promise<void> {
    while (isRunning) {
      try {
        console.log(`[indexer] Fetching events from ledger ${cursor.lastLedger}...`);

        if (stateStore) {
          const storedState = await stateStore.load();
          if (storedState && storedState.lastLedger > cursor.lastLedger) {
            cursor = {
              lastLedger: storedState.lastLedger,
              paginationCursor: storedState.paginationCursor ?? storedState.pagingToken,
            };
          }
        }

        // Fetch events with retry logic
        const response = await fetchEventsWithRetry(
          server,
          contractIds,
          cursor.lastLedger,
          retryConfig,
          networkConfig.sorobanRpcUrl
        );

        // Process the events
        const events = response.events || [];

        console.log(`[indexer] Fetched ${events.length} events successfully`);

        // Invoke the event handler
        await onEvents(events, cursor);

        // Update cursor ONLY after successful processing
        if (response.latestLedger) {
          cursor = {
            lastLedger: response.latestLedger,
            paginationCursor: (response as { cursor?: string }).cursor,
          };
          if (stateStore) {
            await stateStore.save({
              ...cursor,
              pagingToken: (response as { cursor?: string }).cursor,
              updatedAt: new Date().toISOString(),
            });
          }
          console.log(`[indexer] Cursor updated to ledger ${cursor.lastLedger}`);
        }

        // Wait before next poll
        await sleep(pollIntervalMs);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));

        // Check if we'll retry
        const willRetry = isRetryableRpcError(error);

        // Notify error handler
        if (onError) {
          onError(err, willRetry);
        } else {
          console.error(`[indexer] Error: ${err.message}`);
        }

        // If it's not a rate limit error, wait before retrying
        if (!willRetry) {
          await sleep(pollIntervalMs);
        }
      }
    }

    console.log("[indexer] Stopped");
  }

  // Start polling in the background
  poll().catch(function (error) {
    console.error("[indexer] Fatal error in polling loop:", error);
  });

  // Return control interface
  return {
    stop: function () {
      console.log("[indexer] Stopping...");
      isRunning = false;
    },
    getCursor: function () {
      return { ...cursor };
    },
  };
}

/**
 * Options for starting the Horizon streaming indexer.
 */
export interface StreamingIndexerOptions {
  /** Network configuration. */
  networkConfig: StellarNetworkConfig;
  /** Contract IDs to monitor (optional, for filtering). */
  contractIds?: string[];
  /** Callback for handling new events. */
  onEvent: (event: RawEvent) => void | Promise<void>;
  /** Callback for handling errors. */
  onError?: (error: Error) => void;
  /** Optional durable state store used to resume streaming from the last paging token. */
  stateStore?: IngestionStateStore;
  /** Cold-start lookback window in ledgers when no stored cursor exists. */
  coldStartLookbackLedgers?: number;
  /** Retry configuration for stream reconnection backoff. */
  retryConfig?: IndexerRetryConfig;
}

/**
 * Starts a real-time event indexer using Stellar Horizon's transaction stream.
 *
 * This function establishes a persistent SSE connection to Horizon and decodes
 * Soroban events from transaction metadata in real-time.
 */
export function startHorizonStreamingIndexer(options: StreamingIndexerOptions): {
  stop: () => void;
} {
  const {
    networkConfig,
    contractIds,
    onEvent,
    onError,
    stateStore,
    coldStartLookbackLedgers = 0,
    retryConfig = DEFAULT_RETRY_CONFIG,
  } = options;
  const server = new Horizon.Server(networkConfig.horizonUrl);

  let isRunning = true;
  let closeStream: (() => void) | null = null;
  let reconnectAttempt = 0;

  async function resolveStartupCursor(): Promise<string> {
    const storedState = stateStore ? await stateStore.load() : null;
    if (storedState?.pagingToken || storedState?.paginationCursor) {
      return storedState.pagingToken ?? storedState.paginationCursor ?? "now";
    }

    if (storedState?.lastLedger) {
      return String(storedState.lastLedger);
    }

    if (coldStartLookbackLedgers > 0) {
      const response = await server.ledgers().order("desc").limit(1).call();
      const latestLedger = Number(response.records?.[0]?.sequence ?? 0);
      if (latestLedger > 0) {
        return String(Math.max(1, latestLedger - coldStartLookbackLedgers));
      }
    }

    return "now";
  }

  function scheduleReconnect(): void {
    if (!isRunning) return;
    const delayMs = calculateRetryDelay(reconnectAttempt, retryConfig);
    reconnectAttempt = Math.min(reconnectAttempt + 1, retryConfig.maxRetries);
    console.log(`[streaming-indexer] Attempting to reconnect in ${delayMs}ms...`);
    setTimeout(startStream, delayMs);
  }

  async function startStream() {
    if (!isRunning) return;

    const startupCursor = await resolveStartupCursor();
    console.log(
      `[streaming-indexer] Starting Horizon transaction stream from cursor ${startupCursor}...`
    );

    try {
      closeStream = server
        .transactions()
        .cursor(startupCursor)
        .stream({
          onmessage: async (tx: any) => {
            reconnectAttempt = 0;
            if (!tx.result_meta_xdr) return;

            try {
              const meta = xdr.TransactionMeta.fromXDR(tx.result_meta_xdr, "base64");
              let events: xdr.ContractEvent[] = [];

              // Extract events from meta (v3 or v4)
              if (meta.switch() === xdr.TransactionMeta.v3().switch()) {
                events = meta.v3().sorobanMeta().events();
              } else if (meta.switch() === 4) {
                // @ts-ignore - v4 might not be in all types yet
                events = meta.v4().sorobanMeta().events();
              }

              for (const event of events) {
                const contractId = event.contractId()
                  ? StrKey.encodeContract(event.contractId())
                  : "unknown";

                // Filter by contract ID if provided
                if (contractIds && contractIds.length > 0 && !contractIds.includes(contractId)) {
                  continue;
                }

                // Convert to RawEvent format
                const rawEvent: RawEvent = {
                  id: `${tx.id}-${events.indexOf(event)}`,
                  contractId,
                  topics: event
                    .body()
                    .v0()
                    .topics()
                    .map((topic) => `0x${topic.toXDR("hex")}`),
                  data: `0x${event.body().v0().data().toXDR("hex")}`,
                  ledger: tx.ledger_attr,
                  timestamp: Math.floor(Date.now() / 1000), // Horizon tx doesn't have easy timestamp in stream?
                  txHash: tx.hash,
                };

                await onEvent(rawEvent);

                if (stateStore) {
                  const pagingToken = tx.paging_token ?? tx.pagingToken ?? rawEvent.id;
                  await stateStore.save({
                    lastLedger: rawEvent.ledger,
                    paginationCursor: pagingToken,
                    pagingToken,
                    updatedAt: new Date().toISOString(),
                  });
                }
              }
            } catch (err) {
              console.error("[streaming-indexer] Error decoding transaction meta:", err);
            }
          },
          onerror: (err) => {
            console.error("[streaming-indexer] Stream error:", err);
            if (onError) onError(new Error(String(err)));

            scheduleReconnect();
          },
        });
    } catch (err) {
      console.error("[streaming-indexer] Failed to start stream:", err);
      scheduleReconnect();
    }
  }

  startStream();

  return {
    stop: () => {
      isRunning = false;
      if (closeStream) {
        closeStream();
      }
      console.log("[streaming-indexer] Stopped");
    },
  };
}
