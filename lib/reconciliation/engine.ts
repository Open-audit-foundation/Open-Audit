/**
 * Reconciliation Engine
 *
 * Core logic for comparing local database events with Stellar RPC
 * to detect and report data discrepancies.
 */

import { SorobanRpc } from "stellar-sdk";
import { db } from "@/lib/db/client";
import { compareWithRPC } from "./comparator";
import { recordAuditLog } from "./auditor";
import type { ReconciliationJobData } from "@/lib/jobs/queue";

export interface ReconciliationResult {
  startLedger: number;
  endLedger: number;
  eventsProcessed: number;
  eventsMatched: number;
  eventsSkipped: number;
  eventsError: number;
  discrepancies: Array<{
    ledger: number;
    eventId?: string;
    issue: string;
    action: string;
  }>;
  summary: string;
}

/**
 * Run a reconciliation cycle
 */
export async function runReconciliation(
  jobData: ReconciliationJobData
): Promise<ReconciliationResult> {
  const { startLedger, endLedger, contractIds, triggeredBy = "manual", autoFix = false } = jobData;

  console.log(`[reconciliation] Starting for ledgers ${startLedger}-${endLedger}`);

  const result: ReconciliationResult = {
    startLedger,
    endLedger,
    eventsProcessed: 0,
    eventsMatched: 0,
    eventsSkipped: 0,
    eventsError: 0,
    discrepancies: [],
    summary: "",
  };

  try {
    // Update job status to processing
    const jobId = `${startLedger}-${endLedger}-${Date.now()}`;
    await db.reconciliationJob.updateMany(
      { status: "pending", startLedger, endLedger },
      { status: "processing" }
    );

    // Process in chunks to avoid overwhelming memory
    const batchSize = 1000;
    for (let ledger = startLedger; ledger <= endLedger; ledger += batchSize) {
      const batchEnd = Math.min(ledger + batchSize - 1, endLedger);

      console.log(`[reconciliation] Processing ledgers ${ledger}-${batchEnd}...`);

      // Get events from local database
      const localEvents = await db.event.findMany({
        where: {
          ledger: { gte: ledger, lte: batchEnd },
          ...(contractIds && { contractId: { in: contractIds } }),
        },
        orderBy: { ledger: "asc" },
      });

      result.eventsProcessed += localEvents.length;

      // Compare with RPC for each ledger
      for (let currentLedger = ledger; currentLedger <= batchEnd; currentLedger++) {
        try {
          const comparison = await compareWithRPC({
            ledger: currentLedger,
            contractIds,
          });

          result.eventsMatched += comparison.matched;
          result.eventsSkipped += comparison.skipped;

          // Record discrepancies
          for (const discrepancy of comparison.discrepancies) {
            result.discrepancies.push({
              ledger: currentLedger,
              eventId: discrepancy.eventId,
              issue: discrepancy.issue,
              action: discrepancy.action,
            });

            // Record in audit log
            await recordAuditLog({
              jobId,
              action: "detected",
              eventId: discrepancy.eventId,
              ledger: currentLedger,
              details: {
                issue: discrepancy.issue,
                action: discrepancy.action,
              },
            });

            // Auto-fix if enabled
            if (autoFix && discrepancy.action === "reindex") {
              await reindexEvent(discrepancy.eventId);

              await recordAuditLog({
                jobId,
                action: "fixed",
                eventId: discrepancy.eventId,
                ledger: currentLedger,
                details: {
                  issue: discrepancy.issue,
                },
              });
            }
          }
        } catch (error) {
          result.eventsError++;
          console.error(`[reconciliation] Error comparing ledger ${currentLedger}:`, error);

          await recordAuditLog({
            jobId,
            action: "flagged",
            ledger: currentLedger,
            details: {
              error: error instanceof Error ? error.message : String(error),
            },
          });
        }
      }
    }

    // Generate summary
    const discrepancyRate =
      result.eventsProcessed > 0
        ? ((result.discrepancies.length / result.eventsProcessed) * 100).toFixed(2)
        : "0";

    result.summary = `Reconciliation complete: ${result.eventsMatched} matched, ${result.discrepancies.length} discrepancies found (${discrepancyRate}%)`;

    console.log(`[reconciliation] ${result.summary}`);

    // Record completion in audit log
    await recordAuditLog({
      jobId,
      action: "verified",
      details: result,
    });

    return result;
  } catch (error) {
    console.error("[reconciliation] Fatal error:", error);

    const errorMessage = error instanceof Error ? error.message : String(error);

    // Record error in audit log
    await recordAuditLog({
      jobId: `${startLedger}-${endLedger}-error`,
      action: "flagged",
      details: { error: errorMessage },
    });

    throw error;
  }
}

/**
 * Re-index a specific event from the network
 */
async function reindexEvent(eventId: string): Promise<void> {
  // Get the event from database
  const event = await db.event.findUnique({
    where: { id: eventId },
  });

  if (!event) {
    console.warn(`[reconciliation] Event ${eventId} not found`);
    return;
  }

  console.log(`[reconciliation] Re-indexing event ${eventId} (ledger ${event.ledger})`);

  try {
    // Fetch fresh data from RPC
    const { getStellarRPCClient } = await import("@/lib/stellar/client");
    const client = getStellarRPCClient();

    const response = await client.getEvents({
      startLedger: event.ledger,
      filters: [{ type: "contract", contractIds: [event.contractId] }],
    });

    // Find matching event
    const freshEvent = response.events?.find((e: any) => e.id === eventId);

    if (freshEvent) {
      // Update with fresh data
      await db.event.update({
        where: { id: eventId },
        data: {
          rpcVerified: true,
          lastRpcCheck: new Date(),
          updatedAt: new Date(),
        },
      });

      console.log(`[reconciliation] Event ${eventId} re-indexed successfully`);
    } else {
      console.warn(`[reconciliation] Event ${eventId} not found in fresh RPC response`);

      // Mark as error
      await db.event.update({
        where: { id: eventId },
        data: {
          discrepancies: JSON.stringify({
            issue: "Event not found in RPC",
            action: "manual_review",
            timestamp: new Date().toISOString(),
          }),
        },
      });
    }
  } catch (error) {
    console.error(`[reconciliation] Failed to re-index event ${eventId}:`, error);
  }
}

/**
 * Get reconciliation configuration
 */
export async function getReconciliationConfig() {
  const config = await db.reconciliationConfig.findUnique({
    where: { id: "current" },
  });

  return (
    config || {
      id: "current",
      cronSchedule: "0 2 * * *",
      batchSize: 1000,
      lookbackDays: 7,
      autoFix: false,
      alertThreshold: 0.1,
      enabled: true,
    }
  );
}
