#!/usr/bin/env node
/**
 * Standalone Stellar Event Indexer Worker
 *
 * Polls/streams Stellar blockchain for contract events, translates them,
 * and publishes to Redis pub/sub for consumption by the decoupled web server.
 *
 * Run with: npm run worker:indexer
 */

import { createEventMessage, serializeEventMessage } from "../../lib/events/message-envelope";
import { getWorkerId, REDIS_CHANNEL, REDIS_URL } from "../../lib/redis/config";
import { RedisPublisher } from "../../lib/redis/publisher";
import { getNetworkConfig } from "../../lib/stellar/client";
import { startHorizonStreamingIndexer } from "../../lib/stellar/indexer";
import { translateEvent } from "../../lib/translator/registry";
import type { RawEvent } from "../../lib/translator/types";

const WORKER_ID = getWorkerId();
const INDEXER_MODE = process.env.INDEXER_MODE || "stream";
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || "5000", 10);
const CONTRACT_IDS = process.env.CONTRACT_IDS ? process.env.CONTRACT_IDS.split(",") : undefined;
const ENABLE_RESILIENCE = process.env.ENABLE_RESILIENCE !== "false";
const HEALTH_CHECK_INTERVAL_MS = parseInt(process.env.HEALTH_CHECK_INTERVAL_MS || "30000", 10);

class StellarIndexerWorker {
  private publisher: RedisPublisher;
  private indexer: ReturnType<typeof startHorizonStreamingIndexer> | null = null;
  private isRunning = false;
  private processedCount = 0;
  private errorCount = 0;
  private lastProcessedTime: number | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.publisher = new RedisPublisher({
      url: REDIS_URL,
      workerId: WORKER_ID,
    });
  }

  async start(): Promise<void> {
    console.log(`[${WORKER_ID}] Starting Stellar Indexer Worker...`);
    console.log(`[${WORKER_ID}] Mode: ${INDEXER_MODE}`);
    console.log(`[${WORKER_ID}] Network: ${process.env.NEXT_PUBLIC_NETWORK || "testnet"}`);
    console.log(`[${WORKER_ID}] Redis Channel: ${REDIS_CHANNEL}`);
    console.log(`[${WORKER_ID}] Resilience: ${ENABLE_RESILIENCE ? "enabled" : "disabled"}`);

    if (CONTRACT_IDS) {
      console.log(`[${WORKER_ID}] Filtering contracts: ${CONTRACT_IDS.join(", ")}`);
    }

    await this.publisher.connect();

    if (INDEXER_MODE === "stream") {
      this.startStreamingIndexer();
    } else {
      this.startPollingIndexer();
    }

    this.isRunning = true;
    this.startHealthCheck();
    console.log(`[${WORKER_ID}] Worker started successfully`);
  }

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

  private startPollingIndexer(): void {
    console.log(`[${WORKER_ID}] Starting polling indexer (interval: ${POLL_INTERVAL_MS}ms)...`);
    console.warn(`[${WORKER_ID}] Polling mode not fully implemented in this version`);
  }

  private async handleEvent(rawEvent: RawEvent): Promise<void> {
    try {
      const translatedEvent = translateEvent(rawEvent);
      const message = serializeEventMessage(createEventMessage(WORKER_ID, rawEvent, translatedEvent));

      await this.publisher.publish(REDIS_CHANNEL, message);

      this.processedCount++;
      this.lastProcessedTime = Date.now();

      if (this.processedCount % 100 === 0) {
        console.log(`[${WORKER_ID}] Processed ${this.processedCount} events so far`);
      }
    } catch (error) {
      console.error(`[${WORKER_ID}] Error handling event:`, error);
      this.errorCount++;
    }
  }

  private handleError(error: Error): void {
    console.error(`[${WORKER_ID}] Indexer error:`, error.message);
    this.errorCount++;
  }

  private startHealthCheck(): void {
    this.healthCheckInterval = setInterval(async () => {
      const status = this.getStatus();
      console.log(`[${WORKER_ID}] Health Check:`, JSON.stringify(status, null, 2));
      await this.emitHeartbeat();
    }, HEALTH_CHECK_INTERVAL_MS);
  }

  private async emitHeartbeat(): Promise<void> {
    if (!this.publisher.getStatus().connected) {
      return;
    }

    try {
      await this.publisher.setHeartbeat({
        lastSeen: new Date().toISOString(),
        workerId: WORKER_ID,
        processedCount: this.processedCount,
        errorCount: this.errorCount,
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
      });
    } catch (error) {
      console.error(`[${WORKER_ID}] Failed to emit heartbeat:`, error);
    }
  }

  getStatus() {
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

  async stop(): Promise<void> {
    console.log(`[${WORKER_ID}] Shutting down gracefully...`);
    this.isRunning = false;

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    if (this.indexer) {
      this.indexer.stop();
      this.indexer = null;
    }

    await this.publisher.disconnect();
    console.log(`[${WORKER_ID}] Shutdown complete`);
  }
}

const worker = new StellarIndexerWorker();

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
    console.log(`[${WORKER_ID}] Stellar Indexer Worker is running`);
  })
  .catch((error) => {
    console.error(`[${WORKER_ID}] Fatal error starting worker:`, error);
    process.exit(1);
  });
