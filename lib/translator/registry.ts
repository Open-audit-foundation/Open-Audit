/**
 * The Open-Audit Translation Registry
 *
 * This is the central lookup table that maps Contract IDs to their
 * translation blueprints. When a raw event arrives, the registry:
 *
 *   1. Looks up the contract ID in the blueprint map.
 *   2. Calls the blueprint's translate() function.
 *   3. Returns a TranslatedEvent with a human-readable description,
 *      or marks the event as "cryptic" if no blueprint matches.
 *
 * To add support for a new contract, create a blueprint in ./blueprints/
 * and register it in buildRegistry() below.
 */

import { createAllSacBlueprints } from "./blueprints/sac-transfer";
import { createSacMintBurnBlueprint } from "./blueprints/sac-mint-burn";
import { decodeEventName } from "./decode";
import type {
  EventMatchCriteria,
  RawEvent,
  TranslatedEvent,
  TranslationBlueprint,
} from "./types";

/** The registry maps contract IDs to their blueprints. */
type BlueprintRegistry = Map<string, TranslationBlueprint>;

/**
 * Builds the global blueprint registry by collecting all known blueprints.
 * Add new blueprints here as the community contributes them.
 */
function buildRegistry(): BlueprintRegistry {
  const registry: BlueprintRegistry = new Map();

  // Stellar Asset Contract — Transfer events
  // Note: These must come AFTER mint/burn to take precedence (Map overwrites)
  // Or we need a unified blueprint that handles all SAC event types
  for (const blueprint of createAllSacBlueprints()) {
    registry.set(blueprint.contractId, blueprint);
  }

  // Stellar Asset Contract — Mint/Burn events
  // Register mint/burn handlers - they check event type internally
  const mintBurnContracts = [
    "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
    "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  ];
  for (const contractId of mintBurnContracts) {
    const mintBurnBlueprint = createSacMintBurnBlueprint(contractId);
    const existing = registry.get(contractId);
    if (existing) {
      // Merge by creating a combined translate function
      const originalTranslate = existing.translate;
      registry.set(contractId, {
        ...mintBurnBlueprint,
        translate: (event) => originalTranslate(event) ?? mintBurnBlueprint.translate(event),
      });
    } else {
      registry.set(contractId, mintBurnBlueprint);
    }
  }

  // TODO: Add Soroswap Router blueprint (see good-first-issues.json GFI-003)
  // TODO: Add Blend Protocol blueprint
  // TODO: Add Phoenix DEX blueprint

  return registry;
}

/** Singleton registry instance. */
const REGISTRY: BlueprintRegistry = buildRegistry();

/**
 * Translates a single raw Soroban event into a human-readable TranslatedEvent.
 *
 * Lookup order:
 *   1. The caller-supplied `customBlueprints` map (e.g. user-uploaded ABIs from
 *      localStorage). These take precedence so developers can translate their
 *      own contracts before they are merged into the global registry.
 *   2. The global REGISTRY of community blueprints.
 *
 * If neither produces a translation, the event is marked as "cryptic".
 */
export function translateEvent(
  event: RawEvent,
  customBlueprints?: Map<string, TranslationBlueprint>
): TranslatedEvent {
  // 1. Custom (local) blueprints win when they can translate the event.
  const custom = customBlueprints?.get(event.contractId);
  if (custom) {
    const translated = applyBlueprint(event, custom);
    if (translated) return translated;
  }

  // 2. Fall back to the global community registry.
  const blueprint = REGISTRY.get(event.contractId);

  if (!blueprint) {
    return {
      raw: event,
      description: null,
      status: "cryptic",
      // Surface the custom contract name (if any) so the UI still has context.
      blueprintName: custom?.contractName ?? null,
      eventType: null,
    };
  }

  const translated = applyBlueprint(event, blueprint);
  if (translated) return translated;

  return {
    raw: event,
    description: null,
    status: "cryptic",
    blueprintName: blueprint.contractName,
    eventType: null,
  };
}

/**
 * Runs a single blueprint against an event, returning a translated event or
 * null when the blueprint cannot handle it.
 */
function applyBlueprint(event: RawEvent, blueprint: TranslationBlueprint): TranslatedEvent | null {
  if (blueprint.matches && !blueprint.matches(event)) return null;

  const result = blueprint.translate(event);
  if (!result) return null;

  return {
    raw: event,
    description: result.description,
    status: "translated",
    blueprintName: blueprint.contractName,
    eventType: result.eventType,
  };
}

/**
 * Returns true when an event satisfies every requested criterion.
 * Useful for blueprints that must match more than the event signature topic.
 */
export function matchesEventCriteria(
  event: RawEvent,
  criteria: EventMatchCriteria
): boolean {
  if (criteria.contractId && event.contractId !== criteria.contractId) {
    return false;
  }

  for (const topicCriteria of criteria.topics ?? []) {
    const topic = event.topics[topicCriteria.index];
    if (typeof topic !== "string") return false;

    if (topicCriteria.equals && topic !== topicCriteria.equals) {
      return false;
    }

    if (
      topicCriteria.includes &&
      !topic.toLowerCase().includes(topicCriteria.includes.toLowerCase())
    ) {
      return false;
    }

    if (
      topicCriteria.decodedName &&
      decodeEventName(topic) !== topicCriteria.decodedName
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Translates a batch of raw events.
 * Preserves order and handles errors per-event gracefully.
 *
 * @param customBlueprints Optional per-session blueprints (e.g. uploaded ABIs)
 *   that are consulted before the global registry.
 */
export function translateEvents(
  events: RawEvent[],
  customBlueprints?: Map<string, TranslationBlueprint>
): TranslatedEvent[] {
  return events.map(function (event: RawEvent): TranslatedEvent {
    try {
      return translateEvent(event, customBlueprints);
    } catch {
      return {
        raw: event,
        description: null,
        status: "cryptic",
        blueprintName: null,
        eventType: null,
      };
    }
  });
}

/**
 * Returns true if a contract ID has a registered blueprint.
 */
export function hasBlueprint(contractId: string): boolean {
  return REGISTRY.has(contractId);
}

/**
 * Returns the list of all registered contract IDs.
 */
export function getRegisteredContracts(): string[] {
  return Array.from(REGISTRY.keys());
}

/**
 * Returns the number of registered blueprints.
 */
export function getBlueprintCount(): number {
  return REGISTRY.size;
}
