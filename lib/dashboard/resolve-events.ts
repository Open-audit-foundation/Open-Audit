import {
  buildTranslationFromPersisted,
  translateEvents,
  type PersistedRawEvent,
} from "@/lib/translator/registry";
import type {
  Language,
  RawEvent,
  TranslatedEvent,
  TranslationBlueprint,
} from "@/lib/translator/types";

/** Database and API rows have string-valued metadata until it is validated. */
export type DashboardEventRow = Omit<RawEvent, "topics"> & {
  topics: unknown;
  description?: string | null;
  status?: string | null;
  blueprintName?: string | null;
  eventType?: string | null;
  schemaVersion?: string | null;
  parserProvenance?: string | null;
  sandboxError?: string | null;
};

/** Keep the same translation metadata for initial loads and search results. */
export function toDashboardEvent(row: DashboardEventRow): PersistedRawEvent {
  return {
    id: row.id,
    contractId: row.contractId,
    topics: Array.isArray(row.topics)
      ? row.topics.filter((topic): topic is string => typeof topic === "string")
      : [],
    data: row.data,
    ledger: row.ledger,
    timestamp: row.timestamp,
    txHash: row.txHash,
    description: row.description,
    status:
      row.status === "translated" || row.status === "cryptic" || row.status === "pending"
        ? row.status
        : undefined,
    blueprintName: row.blueprintName,
    eventType: row.eventType,
    schemaVersion: row.schemaVersion,
    parserProvenance:
      row.parserProvenance === "native" || row.parserProvenance === "community-wasm"
        ? row.parserProvenance
        : undefined,
    sandboxError: row.sandboxError ?? undefined,
  };
}

/**
 * Resolves the event list the dashboard feed should render.
 *
 * Raw/mock events and explicit custom-ABI overrides use client translation.
 * Stored community results always retain the server's sandbox outcome; the
 * synchronous browser translator cannot reproduce it. Other stored results
 * also pass through unless the viewer supplies a custom ABI for the contract.
 */
export function resolveDisplayEvents(
  events: PersistedRawEvent[],
  customBlueprints: Map<string, TranslationBlueprint>,
  language: Language
): TranslatedEvent[] {
  const results = new Array<TranslatedEvent>(events.length);
  const rawEvents: RawEvent[] = [];
  const rawIndices: number[] = [];

  for (const [index, event] of events.entries()) {
    if (
      event.status !== undefined &&
      (event.parserProvenance === "community-wasm" ||
        !customBlueprints.has(event.contractId))
    ) {
      results[index] = buildTranslationFromPersisted(event);
    } else {
      rawEvents.push(event);
      rawIndices.push(index);
    }
  }

  if (rawEvents.length > 0) {
    const translated = translateEvents(rawEvents, customBlueprints, language);
    for (const [index, event] of translated.entries()) {
      results[rawIndices[index]] = event;
    }
  }

  return results;
}
