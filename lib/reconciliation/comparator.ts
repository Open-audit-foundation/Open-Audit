/**
 * Reconciliation Comparator
 *
 * Compares local database events with Stellar RPC source
 * to detect data gaps and discrepancies.
 */

import { db } from "@/lib/db/client";
import crypto from "crypto";

export interface ComparisonResult {
  ledger: number;
  matched: number;
  skipped: number;
  discrepancies: Array<{
    eventId?: string;
    issue: string;
    action: "reindex" | "manual_review" | "ignore";
  }>;
}

/**
 * Compare local database with RPC for a specific ledger
 */
export async function compareWithRPC(options: {
  ledger: number;
  contractIds?: string[];
}): Promise<ComparisonResult> {
  const { ledger, contractIds } = options;

  const result: ComparisonResult = {
    ledger,
    matched: 0,
    skipped: 0,
    discrepancies: [],
  };

  try {
    // Get events from local database
    const localEvents = await db.event.findMany({
      where: {
        ledger,
        ...(contractIds && { contractId: { in: contractIds } }),
      },
    });

    // Get events from RPC
    const { getStellarRPCClient } = await import("@/lib/stellar/client");
    const client = getStellarRPCClient();

    const rpcResponse = await client.getEvents({
      startLedger: ledger,
      filters: contractIds ? [{ type: "contract", contractIds }] : undefined,
    });

    const rpcEvents = rpcResponse.events || [];

    // Create a map of RPC events by ID for quick lookup
    const rpcEventMap = new Map(rpcEvents.map((e: any) => [e.id, e]));

    // Check for missing events in database
    const missingInDB: string[] = [];
    for (const rpcEvent of rpcEvents) {
      if (!localEvents.find((e) => e.id === rpcEvent.id)) {
        missingInDB.push(rpcEvent.id);
      }
    }

    if (missingInDB.length > 0) {
      result.discrepancies.push({
        issue: `${missingInDB.length} event(s) missing from local database`,
        action: "reindex",
      });

      for (const eventId of missingInDB) {
        result.discrepancies.push({
          eventId,
          issue: "Event missing from local database",
          action: "reindex",
        });
      }
    }

    // Check for extra events in database (shouldn't happen, but check anyway)
    const extraInDB: string[] = [];
    for (const localEvent of localEvents) {
      if (!rpcEventMap.has(localEvent.id)) {
        extraInDB.push(localEvent.id);
      }
    }

    if (extraInDB.length > 0) {
      result.discrepancies.push({
        issue: `${extraInDB.length} event(s) in database not found in RPC`,
        action: "manual_review",
      });

      for (const eventId of extraInDB) {
        result.discrepancies.push({
          eventId,
          issue: "Event in database not found in RPC (possible re-org)",
          action: "manual_review",
        });
      }
    }

    // Verify data integrity for matching events
    for (const localEvent of localEvents) {
      const rpcEvent = rpcEventMap.get(localEvent.id);

      if (rpcEvent) {
        // Compare data integrity
        const localHash = hashEventData(localEvent);
        const rpcHash = hashRPCEvent(rpcEvent);

        if (localHash !== rpcHash) {
          result.discrepancies.push({
            eventId: localEvent.id,
            issue: "Event data mismatch with RPC",
            action: "manual_review",
          });
        } else {
          result.matched++;
        }
      }
    }

    result.skipped = Math.max(0, rpcEvents.length - result.matched - missingInDB.length);

    console.log(
      `[comparator] Ledger ${ledger}: ${result.matched} matched, ${missingInDB.length} missing, ${extraInDB.length} extra`
    );

    return result;
  } catch (error) {
    console.error(`[comparator] Error comparing ledger ${ledger}:`, error);

    result.discrepancies.push({
      issue: `Comparison error: ${error instanceof Error ? error.message : String(error)}`,
      action: "manual_review",
    });

    return result;
  }
}

/**
 * Hash event data from local database
 */
function hashEventData(event: any): string {
  const data = {
    id: event.id,
    contractId: event.contractId,
    ledger: event.ledger,
    topics: event.topics,
    data: event.data,
    txHash: event.txHash,
  };

  return crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex");
}

/**
 * Hash RPC event data
 */
function hashRPCEvent(rpcEvent: any): string {
  const data = {
    id: rpcEvent.id,
    contract_id: rpcEvent.contract_id || rpcEvent.contractId,
    ledger: rpcEvent.ledger,
    topic: rpcEvent.topic || rpcEvent.topics,
    value: rpcEvent.value || rpcEvent.data,
    txHash: rpcEvent.txHash || rpcEvent.transactionHash,
  };

  return crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex");
}

/**
 * Get event statistics for a ledger range
 */
export async function getEventStatistics(
  startLedger: number,
  endLedger: number,
  contractIds?: string[]
) {
  const totalEvents = await db.event.count({
    where: {
      ledger: { gte: startLedger, lte: endLedger },
      ...(contractIds && { contractId: { in: contractIds } }),
    },
  });

  const verifiedEvents = await db.event.count({
    where: {
      ledger: { gte: startLedger, lte: endLedger },
      rpcVerified: true,
      ...(contractIds && { contractId: { in: contractIds } }),
    },
  });

  const eventsWithDiscrepancies = await db.event.count({
    where: {
      ledger: { gte: startLedger, lte: endLedger },
      NOT: { discrepancies: null },
      ...(contractIds && { contractId: { in: contractIds } }),
    },
  });

  return {
    totalEvents,
    verifiedEvents,
    eventsWithDiscrepancies,
    unverifiedEvents: totalEvents - verifiedEvents,
    verificationRate: totalEvents > 0 ? ((verifiedEvents / totalEvents) * 100).toFixed(2) : "0",
  };
}
