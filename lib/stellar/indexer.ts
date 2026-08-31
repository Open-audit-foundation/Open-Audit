/**
 * Stellar Event Indexer with Rate Limit Handling
 *
 * This module implements a robust event indexer that continuously polls
 * the Stellar RPC getEvents endpoint with exponential backoff retry logic
 * to handle HTTP 429 (Too Many Requests) errors gracefully.
 */

import { SorobanRpc, Horizon, xdr, scValToNative, StrKey } from "stellar-sdk";
import {
  initRedis,
  getCachedEvents,
  setCachedEvents,
  isRedisEnabled,
} from "../cache/redisCache";
import { StellarNetworkException, XdrParsingException } from "../errors";
import { createIngestionPool, DEFAULT_WORKER_COUNT, type IngestionPoolMetrics } from "./ingestion-pool";
import type { StellarNetworkConfig } from "./client";
import type { RawEvent } from "../translator/types";
import { reconstructDagFromMetaXdr } from "../dag/engine";
import type { ExecutionDag } from "../dag/types";

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
  maxRetries: 5,
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
export function calculateRetryDelay(
  attemptNumber: number,
  config: IndexerRetryConfig
): number {
  const delay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attemptNumber);
  return Math.min(delay, config.maxDelayMs);
}

function parseRetryAfterHeader(value: unknown): number | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  const seconds = Number(value);
  if (!Number.isNaN(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const parsedDate = Date.parse(value);
  if (!Number.isNaN(parsedDate)) {
    const diff = parsedDate - Date.now();
    return diff > 0 ? diff : 0;
  }

  return null;
}

function getErrorStatusCode(error: unknown): number | undefined {
  if (error && typeof error === "object") {
    const anyError = error as Record<string, unknown>;
    if (typeof anyError.status === "number") {
      return anyError.status;
    }
    if (typeof anyError.statusCode === "number") {
      return anyError.statusCode;
    }
    const response = anyError.response as Record<string, unknown> | undefined;
    if (response) {
      if (typeof response.status === "number") {
        return response.status;
      }
      if (typeof response.statusCode === "number") {
        return response.statusCode;
      }
    }
  }
  return undefined;
}

function getRetryAfterMs(error: unknown): number | null {
  if (error && typeof error === "object") {
    const anyError = error as Record<string, unknown>;
    const response = anyError.response as Record<string, unknown> | undefined;
    const headers = response?.headers ?? anyError.headers;

    if (headers) {
      if (typeof (headers as any).get === "function") {
        return parseRetryAfterHeader((headers as any).get("retry-after"));
      }
      if (typeof (headers as any)["retry-after"] === "string") {
        return parseRetryAfterHeader((headers as any)["retry-after"]);
      }
    }
  }
  return null;
}

/**
 * Checks if an error is an HTTP 429 (Too Many Requests) error.
 */
export function isRetriableError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    // Common retriable patterns: 429, rate limit, timeouts, and network errors
    if (
      message.includes("429") ||
      message.includes("too many requests") ||
      message.includes("rate limit") ||
      message.includes("timeout") ||
      message.includes("timed out") ||
      message.includes("econnreset") ||
      message.includes("etimedout") ||
      message.includes("econnrefused") ||
      message.includes("enotfound") ||
      message.includes("network")
    ) {
      return true;
    }
  }

  // Some libraries attach HTTP status codes to the error object
  const anyErr = error as any;
  if (anyErr && (anyErr.status >= 500 || anyErr.response?.status >= 500)) {
    return true;
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
  endLedger?: number,
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

      // Check if this is a retriable error (rate limit, network, timeouts, 5xx)
      const isRetriable = isRetriableError(error);

      // If it's not retriable, throw immediately
      if (!isRetriable) {
        throw new StellarNetworkException(lastError.message, {
          contractId: contractIds[0],
          ledgerSequence: startLedger,
          operation: "fetchEventsWithRetry",
        }, { cause: lastError, retriable: false });
      }

      // If we've exhausted all retries, throw
      if (attempt >= retryConfig.maxRetries) {
        const ledgerRange = endLedger ? `${startLedger}-${endLedger}` : `${startLedger}`;
        throw new StellarNetworkException(
          `Failed to fetch events after ${retryConfig.maxRetries} retries (ledgers ${ledgerRange}): ${lastError.message}`,
          {
            contractId: contractIds[0],
            ledgerSequence: startLedger,
            operation: "fetchEventsWithRetry",
          },
          { cause: lastError, retriable: true }
        );
      }

      const retryAfterMs = getRetryAfterMs(error);
      const delayMs = retryAfterMs ?? calculateRetryDelay(attempt, retryConfig);
      const cappedDelayMs = Math.min(delayMs, retryConfig.maxDelayMs);

      console.warn(
        `[indexer] Retriable error hit. Retrying in ${delayMs}ms (attempt ${attempt + 1}/${retryConfig.maxRetries})...`
      );

      // Wait before retrying
      await sleep(cappedDelayMs);
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
  /** Callback for handling event batches. */
  onEvents: EventBatchHandler;
  /** Callback for handling errors. */
  onError?: ErrorHandler;
  /** Optional durable state store for resuming from the last processed ledger. */
  stateStore?: IngestionStateStore;
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
    onEvents,
    onError,
    stateStore,
  } = options;

  // Initialize the Soroban RPC server
  const server = new SorobanRpc.Server(networkConfig.sorobanRpcUrl);

  // Initialize cursor state
  let cursor: IndexerCursor = {
    lastLedger: startLedger,
  };

  const initialStatePromise = (async () => {
    const saved = await stateStore?.load();
    if (saved?.lastLedger) {
      cursor = {
        lastLedger: saved.lastLedger,
        paginationCursor: saved.pagingToken,
      };
      console.log(
        `[indexer] Restored cursor from state store at ledger ${cursor.lastLedger}` +
          (cursor.paginationCursor ? ` (${cursor.paginationCursor})` : "")
      );
    }
  })();

  // Control flag for stopping the indexer
  let isRunning = true;

  /**
   * Main polling loop.
   */
  async function poll(): Promise<void> {
    await initialStatePromise;

    while (isRunning) {
      try {
        console.log(`[indexer] Fetching events from ledger ${cursor.lastLedger}...`);

        // Fetch events with retry logic
        const response = await fetchEventsWithRetry(
          server,
          contractIds,
          cursor.lastLedger,
          undefined,
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
            // stellar-sdk v12 does not expose a pagination cursor on GetEventsResponse;
            // retain the previous cursor value until a newer SDK version adds it.
            paginationCursor: (response as unknown as Record<string, unknown>).cursor as string | undefined ?? cursor.paginationCursor,
            paginationCursor: (response as unknown as Record<string, unknown>).cursor as string | undefined,
          };
          await stateStore?.save({
            lastLedger: cursor.lastLedger,
            pagingToken: cursor.paginationCursor,
            updatedAt: new Date().toISOString(),
            source: "rpc",
          });
          console.log(
            `[indexer] Cursor updated to ledger ${cursor.lastLedger}` +
              (cursor.paginationCursor ? `, cursor ${cursor.paginationCursor}` : "")
          );
        }

        // Wait before next poll
        await sleep(pollIntervalMs);
      } catch (error) {
        const willRetry = isRetriableError(error);
        const err =
          error instanceof StellarNetworkException
            ? error
            : new StellarNetworkException(
                error instanceof Error ? error.message : String(error),
                {
                  contractId: contractIds[0],
                  ledgerSequence: cursor.lastLedger,
                  operation: "pollEvents",
                },
                { cause: error, retriable: willRetry }
              );

        console.error('[indexer.ts] Error:', err);

        if (onError) {
          onError(err, willRetry);
        } else {
          console.error(`[indexer] Error: ${err.message}`);
        }

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
  /**
   * Size of the parallel consumer fleet that performs the CPU-heavy work
   * (XDR body decoding + the `onEvent` handler). Defaults to
   * {@link DEFAULT_WORKER_COUNT}. Set to 1 for fully sequential processing.
   */
  workerCount?: number;
  /**
   * Maximum number of in-flight events before the producer applies backpressure
   * to the stream. Omit for an unbounded buffer.
   */
  maxQueueSize?: number;
  /**
   * Optional callback invoked once per transaction when a Soroban execution
   * DAG is successfully reconstructed from DiagnosticEvents.
   * Called on the consumer thread — safe to perform async work.
   */
  onDag?: (dag: ExecutionDag) => void | Promise<void>;
}

/**
 * A lightweight envelope produced for each contract event. The producer fills
 * in only the contract ID (cheap, needed for partition routing); the consumer
 * performs the expensive topic/data XDR decoding when it builds the RawEvent.
 */
interface StreamEventEnvelope {
  event: xdr.ContractEvent;
  contractId: string;
  txId: string;
  txHash: string;
  ledger: number;
  eventIndex: number;
}

/** Decodes a queued envelope into Open-Audit's RawEvent shape (consumer side). */
function envelopeToRawEvent(envelope: StreamEventEnvelope): RawEvent {
  const { event, contractId, txId, txHash, ledger, eventIndex } = envelope;
  return {
    id: `${txId}-${eventIndex}`,
    contractId,
    topics: event
      .body()
      .v0()
      .topics()
      .map((topic) => `0x${topic.toXDR("hex")}`),
    data: `0x${event.body().v0().data().toXDR("hex")}`,
    ledger,
    timestamp: Math.floor(Date.now() / 1000), // Horizon tx doesn't expose close time in the stream.
    txHash,
  };
}

/**
 * Starts a real-time event indexer using Stellar Horizon's transaction stream.
 *
 * This function establishes a persistent SSE connection to Horizon and decodes
 * Soroban events from transaction metadata in real-time.
 *
 * Architecture: Producer / Consumer
 * ─────────────────────────────────
 * The stream callback (Producer) does the minimum work needed to fan events out
 * — extract each contract event and its contract ID — then writes them into a
 * {@link createIngestionPool partitioned channel}. A configurable fleet of
 * consumers drains the channel in parallel, performing the heavy XDR body
 * decoding and invoking `onEvent` (translation / persistence / broadcast).
 *
 * Because events are partitioned by contract ID, all events from one contract
 * are processed in arrival order by a single consumer (strict per-contract
 * ordering), while events from different contracts are processed in parallel —
 * so a ledger carrying thousands of events no longer stalls the stream.
 */
export function startHorizonStreamingIndexer(options: StreamingIndexerOptions): {
  stop: () => void;
  getMetrics: () => IngestionPoolMetrics;
} {
  const { networkConfig, contractIds, onEvent, onError, workerCount, maxQueueSize, onDag } = options;
  const server = new Horizon.Server(networkConfig.horizonUrl);

  let isRunning = true;
  let closeStream: (() => void) | null = null;

  // The consumer fleet: each worker decodes a queued event and runs onEvent.
  const pool = createIngestionPool<StreamEventEnvelope>({
    workerCount: workerCount ?? DEFAULT_WORKER_COUNT,
    maxQueueSize,
    // Partition by contract ID to keep per-contract ordering strictly FIFO.
    partitionKey: (envelope) => envelope.contractId,
    process: async (envelope) => {
      await onEvent(envelopeToRawEvent(envelope));
    },
    onError: (err, item) => {
      const xdrError = new XdrParsingException(
        err.message,
        {
          contractId: item.contractId,
          ledgerSequence: item.ledger,
          txHash: item.txHash,
          operation: "envelopeToRawEvent",
        },
        err
      );
      console.error('[indexer.ts] Error:', xdrError);
      if (onError) onError(xdrError);
    },
  });

  async function startStream() {
    if (!isRunning) return;

    const savedState = await stateStore?.load();
    const streamCursor =
      savedState?.pagingToken ??
      (savedState?.lastLedger ? String(savedState.lastLedger) : "now");

    console.log(
      `[streaming-indexer] Starting Horizon transaction stream from cursor ${streamCursor} ` +
        `(${workerCount ?? DEFAULT_WORKER_COUNT} consumers)` +
        (coldStartLookbackLedgers ? `, lookback hint ${coldStartLookbackLedgers} ledgers` : "") +
        "..."
    );

    try {
      closeStream = server
        .transactions()
        .cursor(streamCursor)
        .stream({
          // Producer: parse the envelope, route events, return fast.
          onmessage: async (tx: any) => {
            if (!tx.result_meta_xdr) return;

            try {
              const meta = xdr.TransactionMeta.fromXDR(tx.result_meta_xdr, "base64") as any;
              let events: xdr.ContractEvent[] = [];

              // Extract events from meta (v3 or v4)
              if (typeof meta?.v3 === "function") {
                events = meta.v3()?.sorobanMeta?.()?.events?.() ?? [];
              } else if (meta.switch() === 4) {
                // @ts-ignore - v4 might not be in all types yet
                events = meta.v4().sorobanMeta().events();
              }

              // ── DAG reconstruction from DiagnosticEvents ─────────────────
              // Runs independently of contract-event filtering so the DAG is
              // always reconstructed for Soroban transactions, regardless of
              // which contractIds are being monitored.
              if (onDag && tx.result_meta_xdr) {
                try {
                  const dag = reconstructDagFromMetaXdr(
                    tx.result_meta_xdr,
                    tx.hash,
                    tx.ledger_attr,
                    Math.floor(Date.now() / 1000)
                  );
                  if (dag !== null) {
                    await onDag(dag);
                  }
                } catch (dagErr) {
                  // Never let DAG errors affect the main event pipeline.
                  console.warn("[streaming-indexer] DAG reconstruction error:", dagErr);
                }
              }

              for (let eventIndex = 0; eventIndex < events.length; eventIndex++) {
                const event = events[eventIndex];
                const contractAddress = event.contractId();
                const contractId = contractAddress
                  ? StrKey.encodeContract(contractAddress as Parameters<typeof StrKey.encodeContract>[0])
                  : "unknown";

                // Filter by contract ID if provided
                if (contractIds && contractIds.length > 0 && !contractIds.includes(contractId)) {
                  continue;
                }

                // Hand off to the consumer fleet (backpressure-aware).
                await pool.enqueue({
                  event,
                  contractId,
                  txId: tx.id,
                  txHash: tx.hash,
                  ledger: tx.ledger_attr,
                  eventIndex,
                });
              }

              await stateStore?.save({
                lastLedger: Number(tx.ledger_attr ?? savedState?.lastLedger ?? 0),
                pagingToken: String(tx.paging_token ?? tx.pagingToken ?? tx.id ?? streamCursor),
                updatedAt: new Date().toISOString(),
                source: "horizon",
              });
            } catch (err) {
              const xdrError = new XdrParsingException(
                err instanceof Error ? err.message : "Failed to decode transaction meta",
                {
                  ledgerSequence: tx.ledger_attr,
                  txHash: tx.hash,
                  xdrHex: tx.result_meta_xdr,
                  operation: "decodeTransactionMeta",
                },
                err
              );
              console.error('[indexer.ts] Error:', xdrError);
              if (onError) onError(xdrError);
            }
          },
          onerror: (err) => {
            const networkError = new StellarNetworkException(
              String(err),
              { operation: "horizonStream" },
              { retriable: true, cause: err }
            );
            console.error('[indexer.ts] Error:', networkError);
            if (onError) onError(networkError);

            // Auto-reconnect logic
            if (isRunning) {
              console.log("[streaming-indexer] Attempting to reconnect in 5s...");
              setTimeout(startStream, 5000);
            }
          },
        });
    } catch (err) {
      const networkError = new StellarNetworkException(
        err instanceof Error ? err.message : "Failed to start Horizon stream",
        { operation: "startHorizonStream" },
        { retriable: true, cause: err }
      );
      console.error('[indexer.ts] Error:', networkError);
      if (onError) onError(networkError);
      if (isRunning) {
        setTimeout(startStream, 5000);
      }
    }
  }

  startStream();

  return {
    stop: () => {
      isRunning = false;
      if (closeStream) {
        closeStream();
      }
      // Drain in-flight events, then stop the consumer fleet.
      void pool.stop();
      console.log("[streaming-indexer] Stopped");
    },
    getMetrics: () => pool.metrics(),
  };
}

export interface ResilientStreamingOptions extends StreamingIndexerOptions {
  captiveCore?: Omit<
    CaptiveCoreSupervisorOptions,
    "stateStore" | "contractIds" | "onEvent" | "onError"
  >;
  fallbackMode?: "horizon" | "rpc";
  fallbackPollIntervalMs?: number;
  retryConfig?: IndexerRetryConfig;
}

export interface ResilientStreamingControls {
  stop: () => Promise<void>;
  getMode: () => "captive-core" | "horizon" | "rpc" | "stopped";
  getMetrics: () => IngestionPoolMetrics | null;
}

export function startResilientEventIngestion(
  options: ResilientStreamingOptions
): ResilientStreamingControls {
  const {
    captiveCore,
    fallbackMode = options.contractIds && options.contractIds.length > 0 ? "rpc" : "horizon",
    fallbackPollIntervalMs = 5000,
    onEvent,
    onError,
    contractIds,
    stateStore,
  } = options;

  let mode: "captive-core" | "horizon" | "rpc" | "stopped" = captiveCore ? "captive-core" : fallbackMode;
  let fallbackStarted = false;
  let fallbackControls:
    | ReturnType<typeof startHorizonStreamingIndexer>
    | IndexerControls
    | null = null;
  let captiveControls: CaptiveCoreControls | null = null;

  const startFallback = () => {
    if (fallbackStarted) {
      return;
    }
    fallbackStarted = true;
    mode = fallbackMode;

    if (fallbackMode === "rpc" && contractIds && contractIds.length > 0) {
      fallbackControls = startEventIndexer({
        networkConfig: options.networkConfig,
        contractIds,
        startLedger: 0,
        pollIntervalMs: fallbackPollIntervalMs,
        retryConfig: options.retryConfig,
        stateStore,
        onEvents: async (events) => {
          for (const event of events) {
            await onEvent(eventResponseToRawEvent(event, contractIds[0]));
          }
        },
        onError: (error) => onError?.(error),
      });
      return;
    }

    fallbackControls = startHorizonStreamingIndexer({
      networkConfig: options.networkConfig,
      contractIds,
      onEvent,
      onError,
      workerCount: options.workerCount,
      maxQueueSize: options.maxQueueSize,
      stateStore,
      coldStartLookbackLedgers: options.coldStartLookbackLedgers,
    });
  };

  if (!captiveCore) {
    startFallback();
  } else {
    void startCaptiveCoreIndexer({
      ...captiveCore,
      contractIds,
      stateStore,
      onEvent,
      onError,
      onExhausted: (error) => {
        onError?.(error);
        startFallback();
      },
    }).then((controls) => {
      captiveControls = controls;
    }).catch((error) => {
      onError?.(error instanceof Error ? error : new Error(String(error)));
      startFallback();
    });
  }

  return {
    stop: async () => {
      mode = "stopped";
      await captiveControls?.stop();
      if (fallbackControls) {
        if ("stop" in fallbackControls) {
          await Promise.resolve(fallbackControls.stop());
        }
      }
    },
    getMode: () => mode,
    getMetrics: () => {
      if (fallbackControls && "getMetrics" in fallbackControls) {
        return fallbackControls.getMetrics();
      }
      return null;
    },
  };
}
