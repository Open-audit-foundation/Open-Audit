import { translateEvents } from "@/lib/translator/registry";
import type {
  Language,
  RawEvent,
  TranslatedEvent,
  TranslationBlueprint,
} from "@/lib/translator/types";

/**
 * Resolves the event list the dashboard feed should render.
 *
 * Mock-data events are raw and must be translated client-side using the
 * viewer's selected language and any locally-uploaded custom blueprints.
 * Events sourced from the database (GET /api/v1/events) arrive already
 * translated by the indexer and must be used as-is — running them through
 * the registry again would double the translation cost and discard the
 * server's stored description/status/blueprintName/eventType fields.
 */
export function resolveDisplayEvents(
  useMockData: boolean,
  rawMockEvents: RawEvent[],
  dbEvents: TranslatedEvent[],
  customBlueprints: Map<string, TranslationBlueprint>,
  language: Language
): TranslatedEvent[] {
  return useMockData
    ? translateEvents(rawMockEvents, customBlueprints, language)
    : dbEvents;
}
