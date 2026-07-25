/**
 * Job Queue Setup
 *
 * Configures Bull queue for background job processing with Redis backend.
 * Also implements Webhook delivery with HMAC signing, retry with exponential
 * backoff, and subscription deactivation on terminal failures.
 */

import Queue from "bull";
import { db } from "@/lib/db/client";
import {
  buildSignatureHeader,
  computeWebhookSignature,
} from "@/lib/webhooks/signing";

export { computeWebhookSignature, buildSignatureHeader };

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_INITIAL_BACKOFF_MS = 2000;
const DEFAULT_TIMEOUT_MS = 10000;
const SIGNATURE_HEADER = "X-Open-Audit-Signature";
const USER_AGENT = "Open-Audit-Webhook/1.0";

export interface WebhookPayload {
  eventId: string;
  contractId: string;
  ledger: number;
  timestamp: number;
  txHash: string;
  topics: string[];
  data: string;
  description: string | null;
  status: string;
  blueprintName: string | null;
  eventType: string | null;
  createdAt: string;
}

export interface WebhookDeliveryConfig {
  maxAttempts?: number;
  initialBackoffMs?: number;
  timeoutMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(status: number | null, err: Error | null): boolean {
  if (status !== null) {
    if (status >= 500 && status < 600) {
      return true;
    }
    if (status >= 400 && status < 500) {
      return false;
    }
  }
  if (err) {
    const msg = err.message.toLowerCase();
    if (
      msg.includes("timeout") ||
      msg.includes("etimedout") ||
      msg.includes("econnreset") ||
      msg.includes("econnrefused") ||
      msg.includes("enetunreach") ||
      msg.includes("ehostunreach") ||
      msg.includes("socket hang up") ||
      msg.includes("network error")
    ) {
      return true;
    }
  }
  return false;
}

async function sendWebhookRequest(
  url: string,
  jsonPayload: string,
  signature: string,
  timeoutMs: number
): Promise<{ status: number | null; error: Error | null }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [SIGNATURE_HEADER]: signature,
        "User-Agent": USER_AGENT,
      },
      body: jsonPayload,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return { status: response.status, error: null };
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err?.name === "AbortError") {
      return { status: null, error: new Error("Request timeout") };
    }
    return { status: null, error: err instanceof Error ? err : new Error(String(err)) };
  }
}

export async function deliverWebhookWithRetries(
  _subscriptionId: string,
  url: string,
  secret: string,
  payload: WebhookPayload,
  config: WebhookDeliveryConfig = {}
): Promise<{ succeeded: boolean; httpStatus: number | null; attempts: number }> {
  const maxAttempts = config.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const initialBackoffMs = config.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const jsonPayload = JSON.stringify(payload);
  const signature = buildSignatureHeader(jsonPayload, secret);

  let attempts = 0;
  let lastStatus: number | null = null;

  for (let i = 0; i < maxAttempts; i++) {
    attempts = i + 1;

    const result = await sendWebhookRequest(url, jsonPayload, signature, timeoutMs);
    lastStatus = result.status;

    if (result.status !== null && result.status >= 200 && result.status < 300) {
      return { succeeded: true, httpStatus: result.status, attempts };
    }

    if (!isRetryableError(result.status, result.error)) {
      return { succeeded: false, httpStatus: result.status, attempts };
    }

    if (attempts < maxAttempts) {
      const backoff = initialBackoffMs * Math.pow(2, i);
      await sleep(backoff);
    }
  }

  return { succeeded: false, httpStatus: lastStatus, attempts };
}

export async function triggerWebhooksForEvent(
  event: {
    id: string;
    contractId: string;
    ledger: number;
    timestamp: number;
    txHash: string;
    topics: unknown;
    data: string;
    description: string | null;
    status: string;
    blueprintName: string | null;
    eventType: string | null;
    createdAt?: Date;
  },
  config: WebhookDeliveryConfig = {}
): Promise<void> {
  try {
    const subscriptions = await db.webhookSubscription.findMany({
      where: {
        isActive: true,
        OR: [{ contractId: null }, { contractId: event.contractId }],
      },
      select: {
        id: true,
        url: true,
        secretHash: true,
      },
    });

    if (subscriptions.length === 0) {
      return;
    }

    const payload: WebhookPayload = {
      eventId: event.id,
      contractId: event.contractId,
      ledger: event.ledger,
      timestamp: event.timestamp,
      txHash: event.txHash,
      topics: Array.isArray(event.topics) ? (event.topics as string[]) : [],
      data: event.data,
      description: event.description,
      status: event.status,
      blueprintName: event.blueprintName,
      eventType: event.eventType,
      createdAt: (event.createdAt ?? new Date()).toISOString(),
    };

    const deliveryPromises = subscriptions.map(async (sub: { id: string; url: string; secretHash: string }) => {
      const result = await deliverWebhookWithRetries(sub.id, sub.url, sub.secretHash, payload, config);

      if (!result.succeeded && result.attempts >= (config.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)) {
        await db.webhookSubscription.update({
          where: { id: sub.id },
          data: { isActive: false, updatedAt: new Date() },
        });
      }

      await db.webhookDelivery.create({
        data: {
          subscriptionId: sub.id,
          eventId: event.id,
          httpStatus: result.httpStatus,
          succeeded: result.succeeded,
          attempts: result.attempts,
        },
      });

      return result;
    });

    await Promise.allSettled(deliveryPromises);
  } catch (error) {
    console.error("[webhooks] Failed to trigger webhooks:", error);
  }
}

// Redis connection for Bull
export function getRedisConfig() {
  const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
  return redisUrl;
}

/**
 * Reconciliation Job Data
 */
export interface ReconciliationJobData {
  startLedger: number;
  endLedger: number;
  contractIds?: string[];
  triggeredBy?: string; // "cron" | "manual"
  autoFix?: boolean;
}

/**
 * Job Queue instances
 */
let reconciliationQueue: Queue.Queue<ReconciliationJobData> | null = null;

/**
 * Get or create reconciliation queue
 */
export function getReconciliationQueue(): Queue.Queue<ReconciliationJobData> {
  if (!reconciliationQueue) {
    reconciliationQueue = new Queue<ReconciliationJobData>("reconciliation", getRedisConfig());

    // Configure queue events
    reconciliationQueue.on("error", (error) => {
      console.error("[queue] Error:", error);
    });

    reconciliationQueue.on("stalled", (job) => {
      console.warn(`[queue] Job ${job.id} stalled`);
    });

    // Set up job completion/failure handlers
    reconciliationQueue.on("completed", async (job) => {
      console.log(`[queue] Job ${job.id} completed`);

      // Update job record in database
      if (job.data.triggeredBy) {
        await db.reconciliationJob.updateMany(
          {
            status: "processing",
            triggeredBy: job.data.triggeredBy,
          },
          {
            status: "completed",
            completedAt: new Date(),
          }
        );
      }
    });

    reconciliationQueue.on("failed", async (job, err) => {
      console.error(`[queue] Job ${job.id} failed:`, err.message);

      // Update job record in database
      if (job.data.triggeredBy) {
        await db.reconciliationJob.updateMany(
          {
            status: "processing",
            triggeredBy: job.data.triggeredBy,
          },
          {
            status: "failed",
            errorMessage: err.message,
            completedAt: new Date(),
          }
        );
      }
    });
  }

  return reconciliationQueue;
}

/**
 * Initialize queue processors
 */
export async function initializeQueueProcessors() {
  const queue = getReconciliationQueue();

  // Set concurrency for reconciliation jobs
  const concurrency = parseInt(process.env.QUEUE_CONCURRENCY || "5", 10);

  queue.process(concurrency, async (job) => {
    console.log(`[queue] Processing reconciliation job ${job.id}`);

    try {
      // Import the reconciliation engine
      const { runReconciliation } = await import("@/lib/reconciliation/engine");

      // Run reconciliation
      const result = await runReconciliation(job.data);

      console.log(
        `[queue] Job ${job.id} completed. Matched: ${result.eventsMatched}, Discrepancies: ${result.discrepancies.length}`
      );

      return result;
    } catch (error) {
      console.error(`[queue] Job ${job.id} error:`, error);
      throw error;
    }
  });
}

/**
 * Add a reconciliation job to the queue
 */
export async function addReconciliationJob(data: ReconciliationJobData): Promise<void> {
  const queue = getReconciliationQueue();

  // Create job record in database
  const job = await db.reconciliationJob.create({
    data: {
      status: "pending",
      startLedger: data.startLedger,
      endLedger: data.endLedger,
      triggeredBy: data.triggeredBy || "manual",
    },
  });

  // Add to queue with retry configuration
  const maxAttempts = parseInt(process.env.QUEUE_MAX_ATTEMPTS || "3", 10);

  await queue.add(data, {
    jobId: job.id,
    attempts: maxAttempts,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
    removeOnComplete: true,
    removeOnFail: false,
  });

  console.log(
    `[queue] Added reconciliation job ${job.id} for ledgers ${data.startLedger}-${data.endLedger}`
  );
}

/**
 * Get queue statistics
 */
export async function getQueueStats() {
  const queue = getReconciliationQueue();

  const [waiting, active, completed, failed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
  ]);

  return {
    waiting,
    active,
    completed,
    failed,
    total: waiting + active + completed + failed,
  };
}

/**
 * Clear queue (for testing/maintenance)
 */
export async function clearQueue() {
  const queue = getReconciliationQueue();
  await queue.clean(0); // Remove all jobs
  console.log("[queue] Queue cleared");
}

/**
 * Gracefully shutdown queue
 */
export async function shutdownQueue() {
  if (reconciliationQueue) {
    console.log("[queue] Shutting down...");
    await reconciliationQueue.close();
    reconciliationQueue = null;
    console.log("[queue] Shutdown complete");
  }
}
