#!/usr/bin/env node
/**
 * Standalone Stellar Event Indexer Worker
 *
 * This is an isolated, standalone process that:
 * 1. Polls/streams Stellar blockchain for contract events
 * 2. Reads the last indexed ledger from the database on startup and resumes
 *    from there (using lib/stellar/indexer-persistent.ts / lib/db/utils.ts).
 * 3. Writes the cursor back to the database after every successfully
 *    processed event batch so restarts are cheap.
 * 4. On SIGTERM, waits for any in-flight batch to finish, writes the final
 *    cursor, and exits cleanly.
 * 5. Publishes translated events to Redis Pub/Sub for consumption by the
 *    WebSocket server.
 *
 * Run with: ts-node --project tsconfig.server.json src/worker/indexer.ts
 * Or: npm run worker:indexer
 */

import Redis from "ioredis";
import { startHorizonStreamingIndexer, startEventIndexer } from "../../lib/stellar/indexer";
import { getNetworkConfig } from "../../lib/stellar/client";
import { translateEvent } from "../../lib/translator/registry";
import { getCursor, updateCursor } from "../../lib/db/utils";
import { eventResponseToRawEvent } from "../../lib/stellar/events";
import type { RawEvent } from "../../lib/translator/types";

// ============================================================================
// Configuration
// ============================================================================

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const REDIS_CHANNEL = process.env.REDIS_CHANNEL || "stellar:events";
const WORKER_ID = process.env.WORKER_ID || `worker-${process.pid}`;
const INDEXER_MODE = process.env.INDEXER_MODE || "stream"; // "stream" or "poll"
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || "5000", 10);
const CONTRACT_IDS = process.env.CONTRACT_IDS
  ? process.env.CONTRACT_IDS.split(",").map((id) => id.trim()).filter(Boolean)
  : undefined;

/**
 * Fallback ledger to start from on first run (when no cursor exists in the DB).
 * Set START_LEDGER in the environment to override.
 */
const START_LEDGER = parseInt(process.env.START_LEDGER || "0", 10);

// Health check interval
const HEALTH_CHECK_INTERVAL_MS = parseInt(
  process.env.HEALTH_CHECK_INTERVAL_MS || "30000",
  10
);

// ============================================================================
// Redis Publisher Client
// ============================================================================

class RedisPublisher {
  private client: Redis | null = null;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 10;
  private readonly reconnectDelayMs = 1000;
  private isConnected = false;
  private publishQueue: Array<{ channel: string; message: string }> = [];
  private readonly maxQueueSize = 1000;

  constructor(private readonly url: string) {}

  /**
   * Initialize Redis connection with auto-reconnect.
   */
  async connect(): Promise<void> {
    try {
      console.log(`[${WORKER_ID}] Connecting to Redis at ${this.url}...`);

      this.client = new Redis(this.url, {
        retryStrategy: (times) => {
          if (times > this.maxReconnectAttempts) {
            console.error(
              `[${WORKER_ID}] Max Redis reconnection attempts reached. Giving up.`
            );
            return null;
          }
          const delay = Math.min(times * this.reconnectDelayMs, 10000);
          console.log(
            `[${WORKER_ID}] Redis reconnecting in ${delay}ms (attempt ${times})...`
          );
          return delay;
        },
        enableReadyCheck: true,
        maxRetriesPerRequest: 3,
      });

      this.client.on("connect", () => {
        console.log(`[${WORKER_ID}] Redis connected`);
      });

      this.client.on("ready", () => {
        console.log(`[${WORKER_ID}] Redis ready`);
        this.isConnected = true;
        this.reconnectAttempts = 0;
        void this.flushQueue();
      });

      this.client.on("error", (error) => {
        console.error(`[${WORKER_ID}] Redis error:`, error.message);
        this.isConnected = false;
      });

      this.client.on("close", () => {
        console.warn(`[${WORKER_ID}] Redis connection closed`);
        this.isConnected = false;
      });

      this.client.on("reconnecting", () => {
        this.reconnectAttempts++;
        console.log(
          `[${WORKER_ID}] Redis reconnecting (attempt ${this.reconnectAttempts})...`
        );
      });

      await new Promise<void>((resolve, reject) => {
        if (!this.client) return reject(new Error("Redis client not initialized"));
        this.client.once("ready", () => resolve());
        this.client.once("error", reject);
        setTimeout(() => reject(new Error("Redis connection timeout")), 10000);
      });

      console.log(`[${WORKER_ID}] Redis publisher ready`);
    } catch (error) {
      console.error(`[${WORKER_ID}] Failed to connect to Redis:`, error);
      throw error;
    }
  }

  /**
   * Publish a message to a Redis channel.
   * Queues messages while Redis is temporarily disconnected.
   */
  async publish(channel: string, message: string): Promise<void> {
    if (!this.client) {
      throw new Error("Redis client not initialized. Call connect() first.");
    }

    if (!this.isConnected) {
      if (this.publishQueue.length < this.maxQueueSize) {
        this.publishQueue.push({ channel, message });
        console.warn(
          `[${WORKER_ID}] Redis disconnected. Queued message ` +
            `(${this.publishQueue.length}/${this.maxQueueSize})`
        );
      } else {
        console.error(
          `[${WORKER_ID}] Publish queue full (${this.maxQueueSize}). Dropping message.`
        );
      }
      return;
    }

    try {
      const subscriberCount = await this.client.publish(channel, message);
      console.log(
        `[${WORKER_ID}] Published to ${channel} (${subscriberCount} subscribers)`
      );
    } catch (error) {
      console.error(`[${WORKER_ID}] Failed to publish to Redis:`, error);
      if (this.publishQueue.length < this.maxQueueSize) {
        this.publishQueue.push({ channel, message });
      }
      throw error;
    }
  }

  /** Drain the in-memory publish queue once the connection is restored. */
  /**
   * Set worker heartbeat in Redis hash
   * Format: HSET open-audit:worker:heartbeat field value field value...
   */
  async setHeartbeat(data: Record<string, any>): Promise<void> {
    if (!this.client || !this.isConnected) {
      return; // Skip if not connected
    }

    try {
      const key = "open-audit:worker:heartbeat";
      const fields: string[] = [];
      
      for (const [field, value] of Object.entries(data)) {
        fields.push(field, typeof value === "string" ? value : JSON.stringify(value));
      }

      await this.client.hset(key, ...fields);
    } catch (error) {
      console.error(`[${WORKER_ID}] Failed to set heartbeat:`, error);
    }
  }

  /**
   * Flush queued messages when connection is restored
   */
  private async flushQueue(): Promise<void> {
    if (this.publishQueue.length === 0) return;

    console.log(
      `[${WORKER_ID}] Flushing ${this.publishQueue.length} queued messages...`
    );

    const queue = [...this.publishQueue];
    this.publishQueue = [];

    for (const { channel, message } of queue) {
      try {
        await this.publish(channel, message);
      } catch (error) {
        console.error(`[${WORKER_ID}] Failed to flush queued message:`, error);
        this.publishQueue.push({ channel, message });
      }
    }
  }

  /** Graceful disconnect. */
  async disconnect(): Promise<void> {
    if (this.client) {
      console.log(`[${WORKER_ID}] Disconnecting Redis publisher...`);
      await this.client.quit();
      this.client = null;
      this.isConnected = false;
    }
  }

  getStatus(): { connected: boolean; queueSize: number; reconnectAttempts: number } {
    return {
      connected: this.isConnected,
      queueSize: this.publishQueue.length,
      reconnectAttempts: this.reconnectAttempts,
    };
  }
}

// ============================================================================
// Indexer Worker
// ============================================================================

class StellarIndexerWorker {
  private publisher: RedisPublisher;
  private indexer:
    | ReturnType<typeof startHorizonStreamingIndexer>
    | ReturnType<typeof startEventIndexer>
    | null = null;

  private isRunning = false;
  private processedCount = 0;
  private errorCount = 0;
  private lastProcessedTime: number | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;

  /**
   * Tracks the ledger number of the batch currently being processed.
   * Held while an in-flight batch is in progress so SIGTERM can wait for it.
   */
  private currentLedger = 0;

  /**
   * Promise that resolves when the in-flight batch completes.
   * Set to a pending promise at the start of each batch and resolved when done.
   */
  private inflight: Promise<void> = Promise.resolve();
  private resolveInflight!: () => void;

  constructor() {
    this.publisher = new RedisPublisher(REDIS_URL);
    this.resetInflight();
  }

  /** Replace the inflight sentinel with a fresh pending promise. */
  private resetInflight(): void {
    this.inflight = new Promise<void>((resolve) => {
      this.resolveInflight = resolve;
    });
    // Mark it as immediately resolved by default (no batch in flight).
    this.resolveInflight();
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  async start(): Promise<void> {
    console.log(`[${WORKER_ID}] Starting Stellar Indexer Worker...`);
    console.log(`[${WORKER_ID}] Mode: ${INDEXER_MODE}`);
    console.log(`[${WORKER_ID}] Network: ${process.env.NEXT_PUBLIC_NETWORK || "testnet"}`);
    console.log(`[${WORKER_ID}] Redis Channel: ${REDIS_CHANNEL}`);

    if (CONTRACT_IDS) {
      console.log(`[${WORKER_ID}] Filtering contracts: ${CONTRACT_IDS.join(", ")}`);
    }

    // Read the persisted cursor.  Fall back to START_LEDGER on first run.
    const storedLedger = await getCursor();
    const resumeLedger = storedLedger > 0 ? storedLedger : START_LEDGER;
    this.currentLedger = resumeLedger;

    if (storedLedger > 0) {
      console.log(
        `[${WORKER_ID}] Resuming from ledger ${resumeLedger} (read from database)`
      );
    } else {
      console.log(
        `[${WORKER_ID}] No stored cursor found. Starting from ledger ${resumeLedger} (START_LEDGER)`
      );
    }

    await this.publisher.connect();

    if (INDEXER_MODE === "stream") {
      this.startStreamingIndexer(resumeLedger);
    } else {
      await this.startPollingIndexer(resumeLedger);
    }

    this.isRunning = true;
    this.startHealthCheck();

    console.log(`[${WORKER_ID}] ✅ Worker started successfully`);
  }

  /**
   * Graceful shutdown:
   * 1. Stop accepting new work from the underlying indexer.
   * 2. Wait for the in-flight batch (if any) to complete.
   * 3. Persist the final cursor so the next startup resumes cleanly.
   * 4. Tear down Redis and the health-check timer.
   */
  async stop(): Promise<void> {
    console.log(`[${WORKER_ID}] Shutting down gracefully...`);
    this.isRunning = false;

    // Stop the health-check timer so it doesn't fire during shutdown.
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    // Signal the underlying indexer to stop producing new events.
    if (this.indexer) {
      this.indexer.stop();
      this.indexer = null;
    }

    // Wait for any in-flight batch to finish before writing the cursor.
    console.log(`[${WORKER_ID}] Waiting for in-flight batch to complete...`);
    await this.inflight;

    // Persist the final cursor.
    if (this.currentLedger > 0) {
      try {
        await updateCursor(this.currentLedger);
        console.log(
          `[${WORKER_ID}] Final cursor persisted at ledger ${this.currentLedger}`
        );
      } catch (err) {
        console.error(`[${WORKER_ID}] Failed to persist final cursor:`, err);
      }
    }

    await this.publisher.disconnect();
    console.log(`[${WORKER_ID}] ✅ Shutdown complete`);
  }

  // --------------------------------------------------------------------------
  // Indexer modes
  // --------------------------------------------------------------------------

  /**
   * Real-time streaming indexer via Horizon SSE.
   * The streaming mode doesn't naturally expose a per-ledger cursor, so we
   * persist after every event using the event's ledger number.
   */
  private startStreamingIndexer(resumeLedger: number): void {
    const networkConfig = getNetworkConfig();

    console.log(
      `[${WORKER_ID}] Starting streaming indexer from ledger ${resumeLedger}...`
    );

    this.indexer = startHorizonStreamingIndexer({
      networkConfig,
      contractIds: CONTRACT_IDS,
      workerCount: parseInt(process.env.INDEXER_WORKER_COUNT || "4", 10),
      maxQueueSize: parseInt(process.env.INDEXER_MAX_QUEUE_SIZE || "1000", 10),
      onEvent: async (rawEvent) => {
        await this.handleStreamEvent(rawEvent);
      },
      onError: (error) => {
        this.handleError(error);
      },
    });
  }

  /**
   * Batch-polling indexer via Soroban RPC getEvents.
   * Reads a ledger range on each tick, calls updateCursor after every
   * successful batch, and respects the in-flight sentinel for SIGTERM.
   */
  private async startPollingIndexer(resumeLedger: number): Promise<void> {
    const networkConfig = getNetworkConfig();

    if (!CONTRACT_IDS || CONTRACT_IDS.length === 0) {
      console.warn(
        `[${WORKER_ID}] Polling mode requires CONTRACT_IDS to be set. Worker will idle.`
      );
      return;
    }

    console.log(
      `[${WORKER_ID}] Starting polling indexer from ledger ${resumeLedger} ` +
        `(interval: ${POLL_INTERVAL_MS}ms)...`
    );

    this.indexer = startEventIndexer({
      networkConfig,
      contractIds: CONTRACT_IDS,
      startLedger: resumeLedger,
      pollIntervalMs: POLL_INTERVAL_MS,
      onEvents: async (events, cursor) => {
        // Mark batch as in-flight before any async work.
        let batchResolve!: () => void;
        this.inflight = new Promise<void>((resolve) => {
          batchResolve = resolve;
        });

        try {
          for (const rawEvent of events) {
            const converted = eventResponseToRawEvent(rawEvent, CONTRACT_IDS![0]);
            await this.handleEvent(converted);
          }

          // Persist cursor after every successfully processed batch.
          if (cursor.lastLedger > 0) {
            this.currentLedger = cursor.lastLedger;
            await updateCursor(cursor.lastLedger);
            console.log(
              `[${WORKER_ID}] Cursor persisted at ledger ${cursor.lastLedger}`
            );
          }
        } finally {
          // Always resolve so SIGTERM is never blocked indefinitely.
          batchResolve();
        }
      },
      onError: (error) => {
        this.handleError(error);
      },
    });
  }

  // --------------------------------------------------------------------------
  // Event handling
  // --------------------------------------------------------------------------

  /**
   * Handle a single event from the streaming indexer.
   * Persists the cursor after each event so restarts have high granularity.
   */
  private async handleStreamEvent(rawEvent: RawEvent): Promise<void> {
    // Mark as in-flight.
    let batchResolve!: () => void;
    this.inflight = new Promise<void>((resolve) => {
      batchResolve = resolve;
    });

    try {
      await this.handleEvent(rawEvent);

      // Persist cursor for the streaming mode (per-event granularity).
      if (rawEvent.ledger > 0) {
        this.currentLedger = rawEvent.ledger;
        await updateCursor(rawEvent.ledger);
      }
    } finally {
      batchResolve();
    }
  }

  /**
   * Core event processing: translate and publish to Redis.
   */
  private async handleEvent(rawEvent: RawEvent): Promise<void> {
    try {
      const translatedEvent = translateEvent(rawEvent);

      const message = JSON.stringify({
        type: "event",
        timestamp: Date.now(),
        workerId: WORKER_ID,
        raw: rawEvent,
        translated: translatedEvent,
      });

      await this.publisher.publish(REDIS_CHANNEL, message);

      this.processedCount++;
      this.lastProcessedTime = Date.now();

      if (this.processedCount % 100 === 0) {
        console.log(`[${WORKER_ID}] Processed ${this.processedCount} events so far`);
      }
    } catch (error) {
      console.error(`[${WORKER_ID}] Error handling event ${rawEvent.id}:`, error);
      this.errorCount++;
    }
  }

  private handleError(error: Error): void {
    console.error(`[${WORKER_ID}] Indexer error:`, error.message);
    this.errorCount++;
  }

  // --------------------------------------------------------------------------
  // Health check
  // --------------------------------------------------------------------------

  private startHealthCheck(): void {
    this.healthCheckInterval = setInterval(() => {
      console.log(
        `[${WORKER_ID}] Health Check:`,
        JSON.stringify(this.getStatus(), null, 2)
      );
    }, HEALTH_CHECK_INTERVAL_MS);
  }

  /**
   * Start periodic health check reporting and heartbeat
   */
  private startHealthCheck(): void {
    this.healthCheckInterval = setInterval(async () => {
      const status = this.getStatus();
      console.log(`[${WORKER_ID}] Health Check:`, JSON.stringify(status, null, 2));
      
      // Emit heartbeat to Redis for status monitoring
      await this.emitHeartbeat();
    }, HEALTH_CHECK_INTERVAL_MS);
  }

  /**
   * Emit worker heartbeat to Redis
   * This allows the status endpoint to check if the worker is alive
   */
  private async emitHeartbeat(): Promise<void> {
    if (!this.publisher.getStatus().connected) {
      return; // Skip if Redis is not connected
    }

    try {
      const timestamp = new Date().toISOString();
      const heartbeatData = {
        lastSeen: timestamp,
        workerId: WORKER_ID,
        processedCount: this.processedCount,
        errorCount: this.errorCount,
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
      };

      // Use the publisher's client to write heartbeat
      // We'll add a method to the publisher for this
      await this.publisher.setHeartbeat(heartbeatData);
    } catch (error) {
      console.error(`[${WORKER_ID}] Failed to emit heartbeat:`, error);
    }
  }

  /**
   * Get worker status
   */
  getStatus(): {
    workerId: string;
    running: boolean;
    mode: string;
    currentLedger: number;
    processedCount: number;
    errorCount: number;
    lastProcessedTime: number | null;
    redis: ReturnType<RedisPublisher["getStatus"]>;
    indexerMetrics?: ReturnType<ReturnType<typeof startHorizonStreamingIndexer>["getMetrics"]>;
  } {
    return {
      workerId: WORKER_ID,
      running: this.isRunning,
      mode: INDEXER_MODE,
      currentLedger: this.currentLedger,
      processedCount: this.processedCount,
      errorCount: this.errorCount,
      lastProcessedTime: this.lastProcessedTime,
      redis: this.publisher.getStatus(),
      indexerMetrics:
        this.indexer && "getMetrics" in this.indexer
          ? (this.indexer as ReturnType<typeof startHorizonStreamingIndexer>).getMetrics()
          : undefined,
    };
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

const worker = new StellarIndexerWorker();

/**
 * SIGTERM: wait for the in-flight batch and write the final cursor before exit.
 * This is the graceful shutdown path used by Docker / PM2 / Kubernetes.
 */
process.on("SIGTERM", () => {
  console.log(`[${WORKER_ID}] Received SIGTERM signal`);
  worker
    .stop()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(`[${WORKER_ID}] Error during SIGTERM shutdown:`, err);
      process.exit(1);
    });
});

process.on("SIGINT", () => {
  console.log(`[${WORKER_ID}] Received SIGINT signal`);
  worker
    .stop()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(`[${WORKER_ID}] Error during SIGINT shutdown:`, err);
      process.exit(1);
    });
});

process.on("uncaughtException", (error) => {
  console.error(`[${WORKER_ID}] Uncaught exception:`, error);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error(`[${WORKER_ID}] Unhandled rejection:`, reason);
  process.exit(1);
});

worker
  .start()
  .then(() => {
    console.log(`[${WORKER_ID}] 🚀 Stellar Indexer Worker is running`);
  })
  .catch((error) => {
    console.error(`[${WORKER_ID}] Fatal error starting worker:`, error);
    process.exit(1);
  });
