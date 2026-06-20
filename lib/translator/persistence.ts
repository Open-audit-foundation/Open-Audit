/**
 * Event Translator with Database Persistence
 *
 * This module handles the translation of raw events into human-readable
 * descriptions and saves them to the database with reconciliation metadata.
 */

import type { RawEvent, TranslatedEvent } from "./types";
import { translateEvent } from "./registry";
import { batchUpsertEvents } from "@/lib/db/utils";
import { db } from "@/lib/db/client";

/**
 * Translates and persists a single event
 */
export async function translateAndPersistEvent(
  rawEvent: RawEvent
): Promise<TranslatedEvent | null> {
  try {
    const translated = await translateEvent(rawEvent);

    if (translated) {
      // Save to database
      await db.event.upsert({
        where: { id: rawEvent.id },
        update: {
          description: translated.description,
          status: translated.status,
          blueprintName: translated.blueprintName,
          eventType: translated.eventType,
          updatedAt: new Date(),
        },
        create: {
          id: rawEvent.id,
          contractId: rawEvent.contractId,
          ledger: rawEvent.ledger,
          timestamp: rawEvent.timestamp,
          txHash: rawEvent.txHash,
          topics: rawEvent.topics,
          data: rawEvent.data,
          description: translated.description,
          status: translated.status,
          blueprintName: translated.blueprintName,
          eventType: translated.eventType,
        },
      });
    }

    return translated;
  } catch (error) {
    console.error(`Failed to translate/persist event ${rawEvent.id}:`, error);
    return null;
  }
}

/**
 * Batch translates and persists multiple events
 */
export async function translateAndPersistBatch(rawEvents: RawEvent[]): Promise<{
  successful: number;
  failed: number;
  translated: TranslatedEvent[];
}> {
  let successful = 0;
  let failed = 0;
  const translated: TranslatedEvent[] = [];

  // Process in smaller batches to avoid overwhelming the database
  const batchSize = 50;
  for (let i = 0; i < rawEvents.length; i += batchSize) {
    const chunk = rawEvents.slice(i, i + batchSize);

    const results = await Promise.all(chunk.map((event) => translateAndPersistEvent(event)));

    for (const result of results) {
      if (result) {
        successful++;
        translated.push(result);
      } else {
        failed++;
      }
    }
  }

  return { successful, failed, translated };
}

/**
 * Mark events as verified by RPC
 */
export async function markEventsAsVerified(ledger: number): Promise<number> {
  const result = await db.event.updateMany({
    where: { ledger },
    data: {
      rpcVerified: true,
      lastRpcCheck: new Date(),
    },
  });

  return result.count;
}

/**
 * Record discrepancies found during reconciliation
 */
export async function recordEventDiscrepancy(
  eventId: string,
  issue: string,
  action: string
): Promise<void> {
  await db.event.update({
    where: { id: eventId },
    data: {
      discrepancies: JSON.stringify({
        issue,
        action,
        timestamp: new Date().toISOString(),
      }),
    },
  });
}
