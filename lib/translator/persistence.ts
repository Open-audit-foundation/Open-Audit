/**
 * Event Translator with Database Persistence
 *
 * This module handles the translation of raw events into human-readable
 * descriptions and saves them to the database.
 */


import type { RawEvent, TranslatedEvent } from "./types";
import { translateWithCache } from "./registry";
import { db } from "../db/client";
import { triggerWebhooksForEvent } from "../jobs/queue";
import { OpenAuditError } from "../errors";
import { setCachedTranslation, isRedisEnabled } from "../cache/redisCache";

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_BATCH_CONCURRENCY = 5;

class Semaphore {
  private activeCount = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly maxConcurrency: number) {}

  async acquire(): Promise<() => void> {
    if (this.activeCount >= this.maxConcurrency) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }

    this.activeCount += 1;

    return () => {
      this.activeCount -= 1;
      const next = this.queue.shift();
      if (next) {
        next();
      }
    };
  }
}

function getBatchConcurrency(): number {
  const rawValue = process.env.BATCH_CONCURRENCY;

  if (!rawValue) {
    return DEFAULT_BATCH_CONCURRENCY;
  }

  const parsed = Number.parseInt(rawValue, 10);

  if (!Number.isFinite(parsed) || parsed < 1) {
    console.warn(
      `[translator] Invalid BATCH_CONCURRENCY value "${rawValue}". Falling back to ${DEFAULT_BATCH_CONCURRENCY}.`
    );
    return DEFAULT_BATCH_CONCURRENCY;
  }

  return parsed;
}

async function mapWithConcurrencyLimit<T, TResult>(
  items: T[],
  maxConcurrency: number,
  mapper: (item: T) => Promise<TResult>
): Promise<TResult[]> {
  const semaphore = new Semaphore(Math.max(1, maxConcurrency));

  return Promise.all(
    items.map(async (item) => {
      const release = await semaphore.acquire();

      try {
        return await mapper(item);
      } finally {
        release();
      }
    })
  );
}

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
    translated = await translateWithCache(rawEvent);
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
    const savedEvent = await db.event.upsert({
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

    // Trigger webhooks for the saved event
    try {
      await triggerWebhooksForEvent(savedEvent);
    } catch (webhookError) {
      console.error("[webhooks] Failed to trigger webhooks:", webhookError);
    }

    if (isRedisEnabled()) {
      await setCachedTranslation(rawEvent, translated);
    }

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

  const batchSize = DEFAULT_BATCH_SIZE;
  const batchConcurrency = getBatchConcurrency();

  for (let i = 0; i < rawEvents.length; i += batchSize) {
    const chunk = rawEvents.slice(i, i + batchSize);

    const results = await mapWithConcurrencyLimit(
      chunk,
      batchConcurrency,
      translateAndPersistEvent
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
