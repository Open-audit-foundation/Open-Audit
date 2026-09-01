import { db } from "./client";
import { RawEvent } from "@/lib/translator/types";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Source tag written to Event.source (Issue #420).
 *   "live"       — emitted by the real-time Soroban/Horizon indexer
 *   "historical" — backfilled by POST /api/ingest-historical
 */
export type EventSource = "live" | "historical";

type EventCreateInput = RawEvent & {
  description?: string;
  status?: string;
  blueprintName?: string;
  eventType?: string;
  /** @default "live" */
  source?: EventSource;
};

// ─── Database helpers ─────────────────────────────────────────────────────────

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
 * Create or update a single event in the database.
 */
export async function upsertEvent(event: EventCreateInput): Promise<void> {
  await db.event.upsert({
    where: { id: event.id },
    update: {
      description: event.description,
      status: event.status,
      blueprintName: event.blueprintName,
      eventType: event.eventType,
      updatedAt: new Date(),
    },
    create: {
      id: event.id,
      contractId: event.contractId,
      ledger: event.ledger,
      timestamp: event.timestamp,
      txHash: event.txHash,
      topics: event.topics,
      data: event.data,
      description: event.description,
      status: event.status,
      blueprintName: event.blueprintName,
      eventType: event.eventType,
      source: event.source ?? "live",
    },
  });
}

/**
 * Batch upsert events for better performance.
 *
 * Processes in chunks of 100 to stay within reasonable per-statement sizes.
 * Returns the number of rows successfully upserted.
 */
export async function batchUpsertEvents(
  events: EventCreateInput[]
): Promise<number> {
  let upsertedCount = 0;

  const chunkSize = 100;
  for (let i = 0; i < events.length; i += chunkSize) {
    const chunk = events.slice(i, i + chunkSize);

    const results = await Promise.all(
      chunk.map(async (event) =>
        db.event
          .upsert({
            where: { id: event.id },
            update: {
              description: event.description,
              status: event.status,
              blueprintName: event.blueprintName,
              eventType: event.eventType,
              updatedAt: new Date(),
            },
            create: {
              id: event.id,
              contractId: event.contractId,
              ledger: event.ledger,
              timestamp: event.timestamp,
              txHash: event.txHash,
              topics: event.topics,
              data: event.data,
              description: event.description,
              status: event.status,
              blueprintName: event.blueprintName,
              eventType: event.eventType,
              source: event.source ?? "live",
            },
          })
          .catch((err) => {
            console.error(`Failed to upsert event ${event.id}:`, err);
            return null;
          })
      )
    );

    upsertedCount += results.filter((r) => r !== null).length;
  }

  return upsertedCount;
}

/**
 * Advance the **live** indexer cursor.
 * Uses id = "current" — never conflicts with historical cursors.
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
 * Get the last ledger processed by the **live** indexer.
 */
export async function getCursor(): Promise<number> {
  const cursor = await db.indexerCursor.findUnique({
    where: { id: "current" },
  });
  return cursor?.lastLedger ?? 0;
}

/**
 * Get event count for a ledger range, optionally filtered by contract and/or source.
 */
export async function getEventCount(
  startLedger: number,
  endLedger: number,
  contractId?: string,
  source?: EventSource
): Promise<number> {
  return db.event.count({
    where: {
      ledger: { gte: startLedger, lte: endLedger },
      ...(contractId && { contractId }),
      ...(source && { source }),
    },
  });
}

/**
 * Get events for a ledger range, optionally filtered by contract and/or source.
 */
export async function getEventsByLedgerRange(
  startLedger: number,
  endLedger: number,
  contractId?: string,
  source?: EventSource
): Promise<any[]> {
  return db.event.findMany({
    where: {
      ledger: { gte: startLedger, lte: endLedger },
      ...(contractId && { contractId }),
      ...(source && { source }),
    },
    orderBy: { ledger: "asc" },
  });
}

/**
 * Delete events older than the given date (for maintenance / retention policy).
 * Returns the number of rows deleted.
 */
export async function deleteOldEvents(beforeDate: Date): Promise<number> {
  const result = await db.event.deleteMany({
    where: { createdAt: { lt: beforeDate } },
  });
  return result.count;
}
