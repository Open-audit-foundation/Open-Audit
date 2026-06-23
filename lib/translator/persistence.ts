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
import { OpenAuditError } from "@/lib/errors";

interface DeadLetterPayload {
  errorCode: string;
  errorMessage: string;
  errorStack?: string | null;
  errorContext?: Record<string, unknown> | null;
}

async function saveDeadLetterEvent(rawEvent: RawEvent, payload: DeadLetterPayload): Promise<void> {
  try {
    await db.deadLetterEvent.create({
      data: {
        eventId: rawEvent.id,
        contractId: rawEvent.contractId,
        ledger: rawEvent.ledger,
        timestamp: rawEvent.timestamp,
        txHash: rawEvent.txHash,
        topics: rawEvent.topics,
        data: rawEvent.data,
        errorCode: payload.errorCode,
        errorMessage: payload.errorMessage,
        errorStack: payload.errorStack ?? undefined,
        errorContext: payload.errorContext ?? undefined,
      },
    });
  } catch (dbError) {
    console.error("[dlq] Failed to save dead letter event:", dbError);
  }
}

/**
 * Translates and persists a single event, offloading bloated data to IPFS.
 */
export async function translateAndPersistEvent(
  rawEvent: RawEvent
): Promise<TranslatedEvent | null> {
  let translated: TranslatedEvent;

  try {
    translated = await translateEvent(rawEvent);
  } catch (error) {
    const errorCode = error instanceof OpenAuditError ? error.code : "INTERNAL_ERROR";
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack ?? null : null;
    const errorContext = error instanceof OpenAuditError ? error.context : null;

    await saveDeadLetterEvent(rawEvent, {
      errorCode,
      errorMessage,
      errorStack,
      errorContext,
    });

    console.error(
      `[dlq] Unparseable event ${rawEvent.id} persisted to DeadLetterEvent with code=${errorCode}`
    );

    return null;
  }

  try {
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

    return translated;
  } catch (error) {
    console.error(`Failed to persist event ${rawEvent.id}:`, error);
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
