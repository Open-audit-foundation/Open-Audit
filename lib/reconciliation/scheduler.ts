/**
 * Reconciliation Cron Scheduler
 *
 * Runs automatic daily reconciliation jobs based on configuration.
 */

import cron from "node-cron";
import { db } from "@/lib/db/client";
import { addReconciliationJob, getReconciliationQueue } from "@/lib/jobs/queue";
import { getReconciliationConfig } from "@/lib/reconciliation/engine";
import { getCursor } from "@/lib/db/utils";

let scheduledJob: cron.ScheduledTask | null = null;

/**
 * Start the cron scheduler
 */
export async function startReconciliationScheduler() {
  const config = await getReconciliationConfig();

  if (!config.enabled) {
    console.log("[scheduler] Reconciliation is disabled");
    return;
  }

  // Parse cron schedule
  const cronSchedule = config.cronSchedule || "0 2 * * *"; // Default: 2 AM daily

  console.log(`[scheduler] Starting reconciliation scheduler with schedule: "${cronSchedule}"`);

  // Schedule the job
  scheduledJob = cron.schedule(cronSchedule, async () => {
    console.log("[scheduler] Running scheduled reconciliation...");

    try {
      // Get the current cursor position
      const lastLedger = await getCursor();

      // Calculate look-back range
      const lookbackDays = config.lookbackDays || 7;
      const lookbackSeconds = lookbackDays * 24 * 60 * 60;

      // Find the oldest event in the lookback window
      const cutoffDate = new Date(Date.now() - lookbackSeconds * 1000);

      const oldestEvent = await db.event.findFirst({
        where: {
          createdAt: { gte: cutoffDate },
        },
        orderBy: { ledger: "asc" },
        select: { ledger: true },
      });

      // Determine reconciliation range
      const startLedger = oldestEvent?.ledger || Math.max(0, lastLedger - 10000);
      const endLedger = lastLedger;

      if (startLedger >= endLedger) {
        console.log("[scheduler] No events to reconcile (startLedger >= endLedger)");
        return;
      }

      console.log(`[scheduler] Queuing reconciliation for ledgers ${startLedger}-${endLedger}`);

      // Add reconciliation job to queue
      await addReconciliationJob({
        startLedger,
        endLedger,
        triggeredBy: "cron",
        autoFix: config.autoFix || false,
      });

      console.log("[scheduler] Reconciliation job queued");
    } catch (error) {
      console.error("[scheduler] Error running scheduled reconciliation:", error);
    }
  });

  // Allow stopping manually
  scheduledJob.start();

  console.log("[scheduler] Reconciliation scheduler started");
}

/**
 * Stop the cron scheduler
 */
export function stopReconciliationScheduler() {
  if (scheduledJob) {
    console.log("[scheduler] Stopping reconciliation scheduler...");
    scheduledJob.stop();
    scheduledJob.destroy();
    scheduledJob = null;
    console.log("[scheduler] Reconciliation scheduler stopped");
  }
}

/**
 * Manually trigger reconciliation (not on cron schedule)
 */
export async function triggerReconciliation(options: {
  startLedger: number;
  endLedger: number;
  contractIds?: string[];
  autoFix?: boolean;
}) {
  console.log(
    `[scheduler] Triggering manual reconciliation for ledgers ${options.startLedger}-${options.endLedger}`
  );

  try {
    await addReconciliationJob({
      startLedger: options.startLedger,
      endLedger: options.endLedger,
      contractIds: options.contractIds,
      triggeredBy: "manual",
      autoFix: options.autoFix || false,
    });

    console.log("[scheduler] Manual reconciliation job queued");

    return { success: true, message: "Reconciliation job queued" };
  } catch (error) {
    console.error("[scheduler] Error queuing manual reconciliation:", error);

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Get scheduler status
 */
export function getSchedulerStatus() {
  return {
    running: scheduledJob !== null,
    nextRun: scheduledJob ? scheduledJob.nextDate().toString() : null,
  };
}

/**
 * Update reconciliation configuration
 */
export async function updateReconciliationConfig(updates: {
  cronSchedule?: string;
  batchSize?: number;
  lookbackDays?: number;
  autoFix?: boolean;
  alertThreshold?: number;
  enabled?: boolean;
}) {
  const config = await db.reconciliationConfig.update({
    where: { id: "current" },
    data: updates,
  });

  // If scheduler is running and enabled status changed, restart
  if ("enabled" in updates) {
    if (updates.enabled && !scheduledJob) {
      await startReconciliationScheduler();
    } else if (!updates.enabled && scheduledJob) {
      stopReconciliationScheduler();
    }
  }

  return config;
}
