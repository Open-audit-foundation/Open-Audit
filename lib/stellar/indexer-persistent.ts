/**
 * Event Indexer with Database Persistence
 *
 * This module wraps the Stellar indexer and adds database persistence,
 * cursor state management, and reconciliation tracking.
 */

import { SorobanRpc } from "stellar-sdk";
import {
  startEventIndexer,
  startHorizonStreamingIndexer,
  IndexerOptions,
  IndexerControls,
  StreamingIndexerOptions,
} from "./indexer";
import { eventResponseToRawEvent } from "./events";
import { translateAndPersistBatch } from "@/lib/translator/persistence";
import { db } from "@/lib/db/client";
import { updateCursor, getCursor } from "@/lib/db/utils";
import type { RawEvent } from "@/lib/translator/types";

/**
 * Options for persistent indexer
 */
export interface PersistentIndexerOptions extends Omit<IndexerOptions, "startLedger"> {
  fallbackStartLedger?: number; // Used if no cursor exists in DB
}

/**
 * Starts an event indexer with database persistence
 *
 * - Loads the last indexed ledger from the database
 * - Saves all received events to the database
 * - Updates cursor state after successful processing
 * - Provides health check and reconciliation statistics
 */
export async function startPersistentEventIndexer(
  options: PersistentIndexerOptions
): Promise<IndexerControls> {
  const { fallbackStartLedger = 0, ...otherOptions } = options;

  // Get the last indexed ledger from database
  const lastLedger = await getCursor();
  const startLedger = lastLedger > 0 ? lastLedger : fallbackStartLedger;

  console.log(
    `[persistent-indexer] Starting from ledger ${startLedger}${lastLedger > 0 ? " (resumed from database)" : " (first run)"}`
  );

  // Create wrapped event handler that persists to database
  const wrappedOnEvents = async (events: SorobanRpc.Api.EventResponse[], cursor: any) => {
    if (events.length === 0) return;

    try {
      console.log(`[persistent-indexer] Processing ${events.length} events...`);

      // Convert RPC events to RawEvent format
      const rawEvents = events.map((event) =>
        eventResponseToRawEvent(event, options.contractIds[0])
      );

      // Translate and persist events
      const { successful, failed, translated } = await translateAndPersistBatch(rawEvents);

      console.log(`[persistent-indexer] Persisted ${successful} events, ${failed} failures`);

      // Update cursor after successful persistence
      if (cursor.lastLedger > lastLedger) {
        await updateCursor(cursor.lastLedger);
      }

      // Call original onEvents handler if provided
      if (otherOptions.onEvents) {
        try {
          await otherOptions.onEvents(events, cursor);
        } catch (err) {
          console.error("[persistent-indexer] Error in onEvents callback:", err);
        }
      }
    } catch (error) {
      console.error("[persistent-indexer] Error processing events:", error);

      // Call error handler
      if (otherOptions.onError) {
        otherOptions.onError(error instanceof Error ? error : new Error(String(error)), true);
      }
    }
  };

  // Start the underlying indexer with persistence wrapper
  return startEventIndexer({
    ...otherOptions,
    startLedger,
    onEvents: wrappedOnEvents,
  });
}

/**
 * Starts a Horizon streaming indexer with database persistence
 *
 * - Saves all streamed events to the database
 * - Provides real-time event processing with durability
 */
export function startPersistentHorizonIndexer(options: StreamingIndexerOptions): {
  stop: () => void;
} {
  // Wrap onEvent to persist to database
  const wrappedOnEvent = async (rawEvent: RawEvent) => {
    try {
      // Save raw event to database
      await db.event.upsert({
        where: { id: rawEvent.id },
        update: { updatedAt: new Date() },
        create: {
          id: rawEvent.id,
          contractId: rawEvent.contractId,
          ledger: rawEvent.ledger,
          timestamp: rawEvent.timestamp,
          txHash: rawEvent.txHash,
          topics: rawEvent.topics,
          data: rawEvent.data,
          status: "pending",
        },
      });

      // Call original handler
      if (options.onEvent) {
        await options.onEvent(rawEvent);
      }
    } catch (error) {
      console.error(`[persistent-horizon-indexer] Error persisting event ${rawEvent.id}:`, error);

      if (options.onError) {
        options.onError(error instanceof Error ? error : new Error(String(error)));
      }
    }
  };

  return startHorizonStreamingIndexer({
    ...options,
    onEvent: wrappedOnEvent,
  });
}

/**
 * Get reconciliation health metrics
 */
export async function getIndexerHealthMetrics() {
  const [totalEvents, verifiedEvents, lastCursor] = await Promise.all([
    db.event.count(),
    db.event.count({ where: { rpcVerified: true } }),
    getCursor(),
  ]);

  const pendingVerification = totalEvents - verifiedEvents;
  const verificationRate =
    totalEvents > 0 ? ((verifiedEvents / totalEvents) * 100).toFixed(2) : "0";

  return {
    totalEvents,
    verifiedEvents,
    pendingVerification,
    verificationRate: `${verificationRate}%`,
    lastLedger: lastCursor,
    healthy: pendingVerification < totalEvents * 0.1, // Less than 10% pending
  };
}
