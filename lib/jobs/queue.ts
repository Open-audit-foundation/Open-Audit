/**
 * Job Queue Setup
 *
 * Configures Bull queue for background job processing with Redis backend.
 */

import Queue from "bull";
import Redis from "ioredis";
import { db } from "@/lib/db/client";
import crypto from "crypto";

// Redis connection for Bull
export function getRedisConfig() {
  const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

  return {
    url: redisUrl,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
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
 * Webhook Job Data
 */
export interface WebhookJobData {
  deliveryId: string;
}

/**
 * Job Queue instances
 */
let reconciliationQueue: Queue.Queue<ReconciliationJobData> | null = null;
let webhookQueue: Queue.Queue<WebhookJobData> | null = null;

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
 * Get or create webhook queue
 */
export function getWebhookQueue(): Queue.Queue<WebhookJobData> {
  if (!webhookQueue) {
    webhookQueue = new Queue<WebhookJobData>("webhooks", getRedisConfig());

    webhookQueue.on("error", (error) => {
      console.error("[webhook-queue] Error:", error);
    });

    webhookQueue.on("stalled", (job) => {
      console.warn(`[webhook-queue] Job ${job.id} stalled`);
    });
  }

  return webhookQueue;
}

/**
 * Sign webhook payload
 */
function signWebhookPayload(payload: string, secret: string): string {
  const hmac = crypto.createHmac("sha256", secret);
  const signature = hmac.update(payload).digest("hex");
  return `sha256=${signature}`;
}

/**
 * Initialize queue processors
 */
export async function initializeQueueProcessors() {
  const reconciliationQueue = getReconciliationQueue();
  const webhookQueue = getWebhookQueue();

  // Set concurrency for reconciliation jobs
  const concurrency = parseInt(process.env.QUEUE_CONCURRENCY || "5", 10);

  reconciliationQueue.process(concurrency, async (job) => {
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

  // Webhook job processor
  webhookQueue.process(concurrency, async (job) => {
    console.log(`[webhook-queue] Processing webhook delivery ${job.data.deliveryId}`);

    try {
      // Get delivery and subscription from DB
      const delivery = await db.webhookDelivery.findUnique({
        where: { id: job.data.deliveryId },
        include: { webhook: true },
      });

      if (!delivery) {
        throw new Error(`Delivery ${job.data.deliveryId} not found`);
      }

      if (delivery.webhook.enabled === false) {
        await db.webhookDelivery.update({
          where: { id: delivery.id },
          data: { status: "failed", lastError: "Webhook subscription disabled" },
        });
        return;
      }

      // Prepare payload
      const payloadString = JSON.stringify(delivery.payload);
      const signature = signWebhookPayload(payloadString, delivery.webhook.secret);

      // Send POST request
      const response = await fetch(delivery.webhook.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Open-Audit-Signature": signature,
        },
        body: payloadString,
      });

      if (response.ok) {
        // Success
        await db.webhookDelivery.update({
          where: { id: delivery.id },
          data: {
            status: "delivered",
            attempts: delivery.attempts + 1,
            deliveredAt: new Date(),
          },
        });
        console.log(`[webhook-queue] Successfully delivered to ${delivery.webhook.url}`);
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      console.error(`[webhook-queue] Error delivering webhook:`, error);

      // Get delivery again (in case it was updated)
      const delivery = await db.webhookDelivery.findUnique({
        where: { id: job.data.deliveryId },
      });

      if (!delivery) throw error;

      const newAttempts = delivery.attempts + 1;
      const isFailed = newAttempts >= delivery.maxAttempts;

      await db.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          attempts: newAttempts,
          status: isFailed ? "failed" : "pending",
          lastError: error instanceof Error ? error.message : String(error),
        },
      });

      if (!isFailed) {
        throw error; // Let Bull retry
      }
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
 * Add a webhook delivery job to the queue
 */
export async function addWebhookJob(deliveryId: string): Promise<void> {
  const queue = getWebhookQueue();

  await queue.add({ deliveryId }, {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
    removeOnComplete: true,
    removeOnFail: false,
  });

  console.log(`[webhook-queue] Added webhook job for delivery ${deliveryId}`);
}

/**
 * Trigger webhooks for an event
 */
export async function triggerWebhooksForEvent(event: any): Promise<void> {
  // Find all enabled webhooks for this contract
  const webhooks = await db.webhookSubscription.findMany({
    where: {
      contractId: event.contractId,
      enabled: true,
    },
  });

  if (webhooks.length === 0) return;

  for (const webhook of webhooks) {
    // Check event type filter if specified
    if (webhook.eventTypes) {
      const eventTypes = webhook.eventTypes as string[];
      if (event.eventType && !eventTypes.includes(event.eventType)) {
        continue;
      }
    }

    // Create delivery record
    const delivery = await db.webhookDelivery.create({
      data: {
        webhookId: webhook.id,
        eventId: event.id,
        contractId: event.contractId,
        payload: event,
        status: "pending",
      },
    });

    // Add to queue
    await addWebhookJob(delivery.id);
  }
}

/**
 * Get queue statistics
 */
export async function getQueueStats() {
  const reconciliationQueue = getReconciliationQueue();
  const webhookQueue = getWebhookQueue();

  const [
    reconciliationWaiting,
    reconciliationActive,
    reconciliationCompleted,
    reconciliationFailed,
    webhookWaiting,
    webhookActive,
    webhookCompleted,
    webhookFailed,
  ] = await Promise.all([
    reconciliationQueue.getWaitingCount(),
    reconciliationQueue.getActiveCount(),
    reconciliationQueue.getCompletedCount(),
    reconciliationQueue.getFailedCount(),
    webhookQueue.getWaitingCount(),
    webhookQueue.getActiveCount(),
    webhookQueue.getCompletedCount(),
    webhookQueue.getFailedCount(),
  ]);

  return {
    reconciliation: {
      waiting: reconciliationWaiting,
      active: reconciliationActive,
      completed: reconciliationCompleted,
      failed: reconciliationFailed,
    },
    webhooks: {
      waiting: webhookWaiting,
      active: webhookActive,
      completed: webhookCompleted,
      failed: webhookFailed,
    },
  };
}

/**
 * Clear queue (for testing/maintenance)
 */
export async function clearQueue() {
  const reconciliationQueue = getReconciliationQueue();
  const webhookQueue = getWebhookQueue();
  await reconciliationQueue.clean(0);
  await webhookQueue.clean(0);
  console.log("[queue] All queues cleared");
}

/**
 * Gracefully shutdown queue
 */
export async function shutdownQueue() {
  if (reconciliationQueue) {
    console.log("[queue] Shutting down reconciliation queue...");
    await reconciliationQueue.close();
    reconciliationQueue = null;
  }
  if (webhookQueue) {
    console.log("[webhook-queue] Shutting down webhook queue...");
    await webhookQueue.close();
    webhookQueue = null;
  }
  console.log("[queue] Shutdown complete");
}
