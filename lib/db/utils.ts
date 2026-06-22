import { db } from "./client";
import { RawEvent } from "@/lib/translator/types";
import { processEventForIpfs } from "@/lib/ipfs/offloader";

/**
 * Initialize database connection and run migrations
 */
export async function initializeDatabase(): Promise<void> {
  try {
    await db.$queryRaw`SELECT 1`;
    console.log("✓ Database connection successful");
  } catch (error) {
    console.error("✗ Database connection failed:", error);
    throw error;
  }
}

/**
 * Create or update an event in the database with IPFS offloading
 */
export async function upsertEvent(
  event: RawEvent & {
    description?: string;
    status?: string;
    blueprintName?: string;
    eventType?: string;
  }
): Promise<void> {
  const processed = await processEventForIpfs(event);

  await db.event.upsert({
    where: { id: event.id },
    update: {
      description: event.description,
      status: event.status,
      blueprintName: event.blueprintName,
      eventType: event.eventType,
      data: processed.data,
      topics: processed.topics,
      ipfsCids: processed.cids.length > 0 ? processed.cids : undefined,
      updatedAt: new Date(),
    },
    create: {
      id: event.id,
      contractId: event.contractId,
      ledger: event.ledger,
      timestamp: event.timestamp,
      txHash: event.txHash,
      topics: processed.topics,
      data: processed.data,
      description: event.description,
      status: event.status,
      blueprintName: event.blueprintName,
      eventType: event.eventType,
      ipfsCids: processed.cids.length > 0 ? processed.cids : undefined,
    },
  });
}

/**
 * Batch insert events for better performance with IPFS offloading
 */
export async function batchUpsertEvents(
  events: Array<
    RawEvent & { description?: string; status?: string; blueprintName?: string; eventType?: string }
  >
): Promise<number> {
  let upsertedCount = 0;

  const chunkSize = 100;
  for (let i = 0; i < events.length; i += chunkSize) {
    const chunk = events.slice(i, i + chunkSize);

    const results = await Promise.all(
      chunk.map(async (event) => {
        const processed = await processEventForIpfs(event);
        return db.event
          .upsert({
            where: { id: event.id },
            update: {
              description: event.description,
              status: event.status,
              blueprintName: event.blueprintName,
              eventType: event.eventType,
              data: processed.data,
              topics: processed.topics,
              ipfsCids: processed.cids.length > 0 ? processed.cids : undefined,
              updatedAt: new Date(),
            },
            create: {
              id: event.id,
              contractId: event.contractId,
              ledger: event.ledger,
              timestamp: event.timestamp,
              txHash: event.txHash,
              topics: processed.topics,
              data: processed.data,
              description: event.description,
              status: event.status,
              blueprintName: event.blueprintName,
              eventType: event.eventType,
              ipfsCids: processed.cids.length > 0 ? processed.cids : undefined,
            },
          })
          .catch((err) => {
            console.error(`Failed to upsert event ${event.id}:`, err);
            return null;
          });
      })
    );

    upsertedCount += results.filter((r) => r !== null).length;
  }

  return upsertedCount;
}

/**
 * Update the indexer cursor to track progress
 */
export async function updateCursor(lastLedger: number): Promise<void> {
  await db.indexerCursor.upsert({
    where: { id: "current" },
    update: {
      lastLedger,
      lastProcessed: new Date(),
    },
    create: {
      id: "current",
      lastLedger,
      lastProcessed: new Date(),
    },
  });
}

/**
 * Get the last indexed ledger
 */
export async function getCursor(): Promise<number> {
  const cursor = await db.indexerCursor.findUnique({
    where: { id: "current" },
  });
  return cursor?.lastLedger ?? 0;
}

/**
 * Get event count for a ledger range
 */
export async function getEventCount(
  startLedger: number,
  endLedger: number,
  contractId?: string
): Promise<number> {
  return db.event.count({
    where: {
      ledger: {
        gte: startLedger,
        lte: endLedger,
      },
      ...(contractId && { contractId }),
    },
  });
}

/**
 * Get events for a ledger range
 */
export async function getEventsByLedgerRange(
  startLedger: number,
  endLedger: number,
  contractId?: string
): Promise<any[]> {
  return db.event.findMany({
    where: {
      ledger: {
        gte: startLedger,
        lte: endLedger,
      },
      ...(contractId && { contractId }),
    },
    orderBy: { ledger: "asc" },
  });
}

/**
 * Clean up old events (for maintenance)
 */
export async function deleteOldEvents(beforeDate: Date): Promise<number> {
  const result = await db.event.deleteMany({
    where: {
      createdAt: {
        lt: beforeDate,
      },
    },
  });
  return result.count;
}

/**
 * Get reconciliation statistics
 */
export async function getReconciliationStats(): Promise<{
  totalEvents: number;
  verifiedEvents: number;
  pendingVerification: number;
  lastCursor: number;
}> {
  const [totalEvents, verifiedEvents, lastCursor] = await Promise.all([
    db.event.count(),
    db.event.count({ where: { rpcVerified: true } }),
    getCursor(),
  ]);

  return {
    totalEvents,
    verifiedEvents,
    pendingVerification: totalEvents - verifiedEvents,
    lastCursor,
  };
}
