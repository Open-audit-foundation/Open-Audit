/**
 * Event Translator with Database Persistence and IPFS Offloading
 *
 * This module handles the translation of raw events into human-readable
 * descriptions and saves them to the database. During persistence, bloated
 * metadata strings (>2KB) inside raw events are automatically offloaded to
 * a local IPFS node and replaced with lightweight CID pointers.
 */

import type { RawEvent, TranslatedEvent } from "./types";
import { translateEvent } from "./registry";
import { db } from "@/lib/db/client";
import { processEventForIpfs } from "@/lib/ipfs/offloader";
import { triggerWebhooksForEvent } from "@/lib/jobs/queue";

/**
 * Translates and persists a single event, offloading bloated data to IPFS.
 */
export async function translateAndPersistEvent(
  rawEvent: RawEvent
): Promise<TranslatedEvent | null> {
  try {
    const translated = await translateEvent(rawEvent);

    if (translated) {
      const processed = await processEventForIpfs(rawEvent);

      const savedEvent = await db.event.upsert({
        where: { id: rawEvent.id },
        update: {
          description: translated.description,
          status: translated.status,
          blueprintName: translated.blueprintName,
          eventType: translated.eventType,
          data: processed.data,
          topics: processed.topics,
          ipfsCids: processed.cids.length > 0 ? processed.cids : undefined,
          updatedAt: new Date(),
        },
        create: {
          id: rawEvent.id,
          contractId: rawEvent.contractId,
          ledger: rawEvent.ledger,
          timestamp: rawEvent.timestamp,
          txHash: rawEvent.txHash,
          topics: processed.topics,
          data: processed.data,
          description: translated.description,
          status: translated.status,
          blueprintName: translated.blueprintName,
          eventType: translated.eventType,
          ipfsCids: processed.cids.length > 0 ? processed.cids : undefined,
        },
      });

      // Trigger webhooks for the saved event
      try {
        await triggerWebhooksForEvent(savedEvent);
      } catch (webhookError) {
        console.error("[webhooks] Failed to trigger webhooks:", webhookError);
      }

      translated.raw.data = processed.data;
      translated.raw.topics = processed.topics;
    }

    return translated;
  } catch (error) {
    console.error(`Failed to translate/persist event ${rawEvent.id}:`, error);
    return null;
  }
}

/**
 * Batch translates and persists multiple events with IPFS offloading.
 */
export async function translateAndPersistBatch(rawEvents: RawEvent[]): Promise<{
  successful: number;
  failed: number;
  translated: TranslatedEvent[];
}> {
  let successful = 0;
  let failed = 0;
  const translated: TranslatedEvent[] = [];

  const batchSize = 50;
  for (let i = 0; i < rawEvents.length; i += batchSize) {
    const chunk = rawEvents.slice(i, i + batchSize);

    const results = await Promise.all(
      chunk.map((event) => translateAndPersistEvent(event))
    );

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
