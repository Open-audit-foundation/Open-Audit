/**
 * Example integration of the event indexer into Open-Audit.
 *
 * This file demonstrates how to integrate the indexer with the dashboard
 * to provide real-time event updates instead of mock data.
 *
 * NOTE: This is an example only. Actual integration would require:
 * - A backend service or API route to run the indexer
 * - A database to store events
 * - WebSocket or polling to update the frontend
 */

import { startEventIndexer } from "./indexer";
import { getNetworkConfig } from "./client";
import { translateEvents } from "@/lib/translator/registry";
import type { SorobanRpc } from "stellar-sdk";
import type { RawEvent, TranslatedEvent } from "@/lib/translator/types";

/**
 * Convert a Stellar SDK event response to our RawEvent format.
 */
function convertToRawEvent(
  event: SorobanRpc.Api.EventResponse,
  contractId: string
): RawEvent {
  return {
    id: event.id,
    contractId,
    topics: event.topic as unknown as string[], // Array of hex-encoded topics
    data: event.value.toString(), // XDR-encoded data
    ledger: event.ledger,
    timestamp: Date.now(), // Note: You may want to get actual block timestamp
    txHash: event.txHash || "unknown",
  };
}

/**
 * Simple in-memory event store for demonstration.
 * In production, use a real database (PostgreSQL, MongoDB, etc.).
 */
class EventStore {
  private events: Map<string, TranslatedEvent[]> = new Map();

  /**
   * Add events for a contract.
   */
  addEvents(contractId: string, events: TranslatedEvent[]): void {
    const existing = this.events.get(contractId) || [];
    this.events.set(contractId, [...existing, ...events]);

    console.log(
      `[event-store] Added ${events.length} events for ${contractId}. Total: ${this.events.get(contractId)?.length}`
    );
  }

  /**
   * Get all events for a contract.
   */
  getEvents(contractId: string): TranslatedEvent[] {
    return this.events.get(contractId) || [];
  }

  /**
   * Get all events across all contracts.
   */
  getAllEvents(): TranslatedEvent[] {
    const allEvents: TranslatedEvent[] = [];
    this.events.forEach((events) => {
      allEvents.push(...events);
    });
    // Sort by timestamp descending
    return allEvents.sort(function (a, b) {
      return b.raw.timestamp - a.raw.timestamp;
    });
  }

  /**
   * Clear all events.
   */
  clear(): void {
    this.events.clear();
  }
}

// Global event store instance
const eventStore = new EventStore();

/**
 * Start monitoring a contract for events.
 *
 * This function starts an indexer that continuously polls for new events
 * and stores them in the event store with translation applied.
 *
 * @param contractId - The contract ID to monitor
 * @param startLedger - The ledger to start from (defaults to 1000 ledgers ago)
 * @returns Indexer controls to stop monitoring
 */
export function startMonitoringContract(
  contractId: string,
  startLedger?: number
): ReturnType<typeof startEventIndexer> {
  const networkConfig = getNetworkConfig();

  console.log(`[indexer-service] Starting indexer for contract ${contractId}`);

  const indexer = startEventIndexer({
    networkConfig,
    contractIds: [contractId],
    startLedger: startLedger || 1000,
    pollIntervalMs: 5000, // Poll every 5 seconds

    onEvents: async function (events, cursor) {
      console.log(
        `[indexer-service] Received ${events.length} events at ledger ${cursor.lastLedger}`
      );

      if (events.length === 0) {
        return;
      }

      // Convert Stellar SDK events to RawEvents
      const rawEvents = events.map(function (event) {
        return convertToRawEvent(event, contractId);
      });

      // Translate the events
      const translatedEvents = translateEvents(rawEvents);

      // Store the translated events
      eventStore.addEvents(contractId, translatedEvents);

      console.log(
        `[indexer-service] Processed and stored ${translatedEvents.length} events`
      );
    },

    onError: function (error, willRetry) {
      console.error(`[indexer-service] Error: ${error.message}`);
      if (willRetry) {
        console.log("[indexer-service] Will retry with exponential backoff...");
      } else {
        console.error("[indexer-service] Non-recoverable error occurred");
      }
    },

    retryConfig: {
      initialDelayMs: 1000, // 1 second
      maxDelayMs: 32000, // 32 seconds
      maxRetries: 10,
      backoffMultiplier: 2,
    },
  });

  return indexer;
}

/**
 * Get events for a specific contract from the store.
 */
export function getContractEvents(contractId: string): TranslatedEvent[] {
  return eventStore.getEvents(contractId);
}

/**
 * Get all events from the store.
 */
export function getAllEvents(): TranslatedEvent[] {
  return eventStore.getAllEvents();
}

/**
 * Example usage in a Next.js API route:
 *
 * ```typescript
 * // app/api/events/[contractId]/route.ts
 * import { NextRequest, NextResponse } from "next/server";
 * import { getContractEvents, startMonitoringContract } from "@/lib/stellar/example-integration";
 *
 * // Store active indexers
 * const activeIndexers = new Map();
 *
 * export async function GET(
 *   request: NextRequest,
 *   { params }: { params: { contractId: string } }
 * ): Promise<NextResponse> {
 *   const { contractId } = params;
 *
 *   // Start indexer if not already running
 *   if (!activeIndexers.has(contractId)) {
 *     const indexer = startMonitoringContract(contractId);
 *     activeIndexers.set(contractId, indexer);
 *   }
 *
 *   // Get events from store
 *   const events = getContractEvents(contractId);
 *
 *   return NextResponse.json({
 *     success: true,
 *     contractId,
 *     events,
 *     count: events.length,
 *   });
 * }
 * ```
 *
 * Example usage in a background service:
 *
 * ```typescript
 * // scripts/start-indexer.ts
 * import { startMonitoringContract } from "@/lib/stellar/example-integration";
 *
 * const CONTRACTS_TO_MONITOR = [
 *   "CABC...XYZ", // Soroswap Router
 *   "CDEF...123", // Stellar Asset Contract
 * ];
 *
 * console.log("Starting indexer service...");
 *
 * const indexers = CONTRACTS_TO_MONITOR.map(function (contractId) {
 *   return startMonitoringContract(contractId, 1000);
 * });
 *
 * // Handle shutdown gracefully
 * process.on("SIGINT", function () {
 *   console.log("Shutting down indexers...");
 *   indexers.forEach(function (indexer) {
 *     indexer.stop();
 *   });
 *   process.exit(0);
 * });
 * ```
 */
