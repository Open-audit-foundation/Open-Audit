/**
 * Job Queue Setup
 *
 * Configures Bull queue for background job processing with Redis backend.
 */

import Queue from "bull";
import Redis from "ioredis";
import { db } from "@/lib/db/client";

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
