#!/usr/bin/env node
/**
 * Standalone Stellar Event Indexer Worker
 *
 * This is an isolated, standalone process that:
 * 1. Polls/streams Stellar blockchain for contract events
 * 2. Processes and translates events
 * 3. Publishes events to Redis Pub/Sub for consumption by WebSocket server
 *
 * This worker is completely decoupled from the Next.js server and can run
 * independently in its own container/process.
 *
 * Run with: ts-node --project tsconfig.server.json src/worker/indexer.ts
 * Or: npm run worker:indexer
 */

import Redis from "ioredis";
import { startHorizonStreamingIndexer } from "../../lib/stellar/indexer";
import { getNetworkConfig } from "../../lib/stellar/client";
import { translateEvent } from "../../lib/translator/registry";
import { fetchContractEventsResilient } from "../../lib/stellar/resilient-stellar-client";
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
  ? process.env.CONTRACT_IDS.split(",")
  : undefined;

// Resilience settings (for polling mode)
const ENABLE_RESILIENCE = process.env.ENABLE_RESILIENCE !== "false";

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
  private maxReconnectAttempts = 10;
  private reconnectDelayMs = 1000;
  private isConnected = false;
  private publishQueue: Array<{ channel: string; message: string }> = [];
  private maxQueueSize = 1000;

  constructor(private url: string) {}

  /**
   * Initialize Redis connection with auto-reconnect
   */
  async connect(): Promise<void> {
    try {
      console.log(`[${WORKER_ID}] Connecting to Redis at ${this.url}...`);

      this.client = new Redis(this.url, {
        // Retry strategy with exponential backoff
        retryStrategy: (times) => {
          if (times > this.maxReconnectAttempts) {
            console.error(
              `[${WORKER_ID}] Max Redis reconnection attempts reached. Giving up.`
            );
            return null; // Stop retrying
          }

          const delay = Math.min(times * this.reconnectDelayMs, 10000);
          console.log(`[${WORKER_ID}] Redis reconnecting in ${delay}ms (attempt ${times})...`);
          return delay;
        },
        // Auto-reconnect on connection loss
        enableReadyCheck: true,
        maxRetriesPerRequest: 3,
      });

      // Connection event handlers
      this.client.on("connect", () => {
        console.log(`[${WORKER_ID}] Redis connected`);
      });

      this.client.on("ready", () => {
        console.log(`[${WORKER_ID}] Redis ready`);
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.flushQueue();
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
        console.log(`[${WORKER_ID}] Redis reconnecting (attempt ${this.reconnectAttempts})...`);
      });

      // Wait for ready state
      await new Promise<void>((resolve, reject) => {
        if (!this.client) return reject(new Error("Redis client not initialized"));

        this.client.once("ready", () => resolve());
        this.client.once("error", reject);

        // Timeout after 10 seconds
        setTimeout(() => reject(new Error("Redis connection timeout")), 10000);
      });

      console.log(`[${WORKER_ID}] Redis publisher ready`);
    } catch (error) {
      console.error(`[${WORKER_ID}] Failed to connect to Redis:`, error);
      throw error;
    }
  }

  /**
   * Publish an event to Redis channel
   * Queues messages if Redis is temporarily disconnected
   */
  async publish(channel: string, message: string): Promise<void> {
    if (!this.client) {
      throw new Error("Redis client not initialized. Call connect() first.");
    }

    // If not connected, queue the message
    if (!this.isConnected) {
      if (this.publishQueue.length < this.maxQueueSize) {
        this.publishQueue.push({ channel, message });
        console.warn(
          `[${WORKER_ID}] Redis disconnected. Queued message (${this.publishQueue.length}/${this.maxQueueSize})`
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
      // Queue for retry
      if (this.publishQueue.length < this.maxQueueSize) {
        this.publishQueue.push({ channel, message });
      }
      throw error;
    }
  }

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

    console.log(`[${WORKER_ID}] Flushing ${this.publishQueue.length} queued messages...`);

    const queue = [...this.publishQueue];
    this.publishQueue = [];

    for (const { channel, message } of queue) {
      try {
        await this.publish(channel, message);
      } catch (error) {
        console.error(`[${WORKER_ID}] Failed to flush queued message:`, error);
        // Re-queue if failed
        this.publishQueue.push({ channel, message });
      }
    }
  }

  /**
   * Graceful disconnect
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      console.log(`[${WORKER_ID}] Disconnecting Redis publisher...`);
      await this.client.quit();
      this.client = null;
      this.isConnected = false;
    }
  }

  /**
   * Get connection status
   */
  getStatus(): {
    connected: boolean;
    queueSize: number;
    reconnectAttempts: number;
  } {
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
  private indexer: ReturnType<typeof startHorizonStreamingIndexer> | null = null;
  private isRunning = false;
  private processedCount = 0;
  private errorCount = 0;
  private lastProcessedTime: number | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.publisher = new RedisPublisher(REDIS_URL);
  }

  /**
   * Initialize the worker
   */
  async start(): Promise<void> {
    try {
      console.log(`[${WORKER_ID}] Starting Stellar Indexer Worker...`);
      console.log(`[${WORKER_ID}] Mode: ${INDEXER_MODE}`);
      console.log(`[${WORKER_ID}] Network: ${process.env.NEXT_PUBLIC_NETWORK || "testnet"}`);
      console.log(`[${WORKER_ID}] Redis Channel: ${REDIS_CHANNEL}`);
      console.log(`[${WORKER_ID}] Resilience: ${ENABLE_RESILIENCE ? "enabled" : "disabled"}`);

      if (CONTRACT_IDS) {
        console.log(`[${WORKER_ID}] Filtering contracts: ${CONTRACT_IDS.join(", ")}`);
      }

      // Connect to Redis
      await this.publisher.connect();

      // Start the indexer based on mode
      if (INDEXER_MODE === "stream") {
        this.startStreamingIndexer();
      } else {
        this.startPollingIndexer();
      }

      this.isRunning = true;

      // Start health check reporter
      this.startHealthCheck();

      console.log(`[${WORKER_ID}] ✅ Worker started successfully`);
    } catch (error) {
      console.error(`[${WORKER_ID}] Failed to start worker:`, error);
      throw error;
    }
  }

  /**
   * Start streaming indexer (real-time via Horizon SSE)
   */
  private startStreamingIndexer(): void {
    const networkConfig = getNetworkConfig();

    console.log(`[${WORKER_ID}] Starting real-time streaming indexer...`);

    this.indexer = startHorizonStreamingIndexer({
      networkConfig,
      contractIds: CONTRACT_IDS,
      workerCount: parseInt(process.env.INDEXER_WORKER_COUNT || "4", 10),
      maxQueueSize: parseInt(process.env.INDEXER_MAX_QUEUE_SIZE || "1000", 10),
      onEvent: async (rawEvent) => {
        await this.handleEvent(rawEvent);
      },
      onError: (error) => {
        this.handleError(error);
      },
    });
  }

  /**
   * Start polling indexer (batch polling)
   */
  private startPollingIndexer(): void {
    console.log(`[${WORKER_ID}] Starting polling indexer (interval: ${POLL_INTERVAL_MS}ms)...`);

    // Implementation for polling mode
    // (Can be extended based on requirements)
    console.warn(`[${WORKER_ID}] Polling mode not fully implemented in this version`);
  }

  /**
   * Handle an event from the indexer
   */
  private async handleEvent(rawEvent: RawEvent): Promise<void> {
    try {
      // Translate the event
      const translatedEvent = translateEvent(rawEvent);

      // Prepare the message payload
      const message = JSON.stringify({
        type: "event",
        timestamp: Date.now(),
        workerId: WORKER_ID,
        raw: rawEvent,
        translated: translatedEvent,
      });

      // Publish to Redis
      await this.publisher.publish(REDIS_CHANNEL, message);

      // Update metrics
      this.processedCount++;
      this.lastProcessedTime = Date.now();

      if (this.processedCount % 100 === 0) {
        console.log(`[${WORKER_ID}] Processed ${this.processedCount} events so far`);
      }
    } catch (error) {
      console.error(`[${WORKER_ID}] Error handling event:`, error);
      this.errorCount++;
      console.error('[indexer.ts] Error:', error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Handle indexer errors
   */
  private handleError(error: Error): void {
    console.error(`[${WORKER_ID}] Indexer error:`, error.message);
    this.errorCount++;
    console.error('[indexer.ts] Error:', error);
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
    processedCount: number;
    errorCount: number;
    lastProcessedTime: number | null;
    redis: ReturnType<RedisPublisher["getStatus"]>;
    indexerMetrics?: any;
  } {
    return {
      workerId: WORKER_ID,
      running: this.isRunning,
      mode: INDEXER_MODE,
      processedCount: this.processedCount,
      errorCount: this.errorCount,
      lastProcessedTime: this.lastProcessedTime,
      redis: this.publisher.getStatus(),
      indexerMetrics: this.indexer?.getMetrics(),
    };
  }

  /**
   * Graceful shutdown
   */
  async stop(): Promise<void> {
    console.log(`[${WORKER_ID}] Shutting down gracefully...`);
    this.isRunning = false;

    // Stop health check
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    // Stop indexer
    if (this.indexer) {
      this.indexer.stop();
      this.indexer = null;
    }

    // Disconnect Redis
    await this.publisher.disconnect();

    console.log(`[${WORKER_ID}] ✅ Shutdown complete`);
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

const worker = new StellarIndexerWorker();

// Graceful shutdown handlers
process.on("SIGTERM", async () => {
  console.log(`[${WORKER_ID}] Received SIGTERM signal`);
  await worker.stop();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log(`[${WORKER_ID}] Received SIGINT signal`);
  await worker.stop();
  process.exit(0);
});

// Handle uncaught errors
process.on("uncaughtException", (error) => {
  console.error(`[${WORKER_ID}] Uncaught exception:`, error);
  console.error('[indexer.ts] Error:', error);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error(`[${WORKER_ID}] Unhandled rejection:`, reason);
  console.error('[indexer.ts] Error:', new Error(String(reason)));
  process.exit(1);
});

// Start the worker
worker
  .start()
  .then(() => {
    console.log(`[${WORKER_ID}] 🚀 Stellar Indexer Worker is running`);
  })
  .catch((error) => {
    console.error(`[${WORKER_ID}] Fatal error starting worker:`, error);
    process.exit(1);
  });
