/**
 * The Open-Audit Translation Registry
 *
 * This is the central lookup table that maps Contract IDs to their
 * translation blueprints. When a raw event arrives, the registry:
 *
 *   1. Looks up the contract ID in the blueprint map.
 *   2. Selects the most recent versioned schema whose validFromLedger ≤ event.ledger.
 *   3. Calls the blueprint's translate() function.
 *   4. Returns a TranslatedEvent with a human-readable description,
 *      or marks the event as "cryptic" if no blueprint matches.
 *
 * To add support for a new contract, create a blueprint in ./blueprints/
 * and register it in buildRegistry() below.
 *
 * To support a contract upgrade, register an additional VersionedTranslationBlueprint
 * with a `validFromLedger` set to the first ledger of the upgraded contract.
 */

import { createAllSacBlueprints } from "./blueprints/sac-transfer";
import { createSacMintBurnBlueprint } from "./blueprints/sac-mint-burn";
import { decodeEventName } from "./core";
import { sanitizeTextField } from "./core";
import { RegistryTemplateException } from "../errors";
import { captureExceptionSync } from "../telemetry";
import type {
  EventMatchCriteria,
  RawEvent,
  TranslatedEvent,
  TranslationBlueprint,
  Language,
} from "./types";

/**
 * The registry maps contract IDs to an array of versioned blueprints,
 * sorted descending by validFromLedger so the newest schema is tried first.
 */
type BlueprintRegistry = Map<string, VersionedTranslationBlueprint[]>;

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
        translate: (event, lang) => originalTranslate(event, lang) ?? mintBurnBlueprint.translate(event, lang),
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
 * Selects the correct versioned blueprint for an event by finding the newest
 * schema whose validFromLedger is less than or equal to the event's ledger.
 *
 * Blueprints are pre-sorted descending by validFromLedger, so the first match
 * is always the most recent applicable version.
 */
function resolveBlueprint(
  blueprints: VersionedTranslationBlueprint[],
  ledger: number
): VersionedTranslationBlueprint | null {
  for (const blueprint of blueprints) {
    if ((blueprint.validFromLedger ?? 0) <= ledger) {
      return blueprint;
    }
  }
  return null;
}

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
  customBlueprints?: Map<string, TranslationBlueprint>,
  lang: Language = "en"
): TranslatedEvent {
  // 1. Custom (local) blueprints win when they can translate the event.
  const custom = customBlueprints?.get(event.contractId);
  if (custom) {
    const translated = applyBlueprint(event, custom, lang);
    if (translated) return translated;
  }

  // 2. Fall back to the global community registry.
  const entry = REGISTRY.get(event.contractId);

  if (!entry) {
    console.warn(`No translation blueprint found for contract ${event.contractId}`);
    return {
      raw: event,
      description: `[Unknown Event: No blueprint registered for contract ${event.contractId}. Hex Data: ${event.data}]`,
      status: "cryptic",
      // Surface the custom contract name (if any) so the UI still has context.
      blueprintName: custom?.contractName ? sanitizeTextField(custom.contractName, { maxLength: 100 }) : null,
      eventType: null,
      schemaVersion: null,
    };
  }

  const blueprint = Array.isArray(entry)
    ? resolveBlueprint(entry, event.ledger)
    : entry;

  if (!blueprint) {
    console.warn(`No translation blueprint applicable for contract ${event.contractId} at ledger ${event.ledger}`);
    return {
      raw: event,
      description: `[Unknown Event: No blueprint applicable for contract ${event.contractId} at ledger ${event.ledger}. Hex Data: ${event.data}]`,
      status: "cryptic",
      blueprintName: Array.isArray(entry) ? entry[0].contractName : entry.contractName,
      eventType: null,
    };
  }

  const translated = applyBlueprint(event, blueprint, lang);
  if (translated) return translated;

  return {
    raw: event,
    description: null,
    status: "cryptic",
    blueprintName: blueprint.contractName ? sanitizeTextField(blueprint.contractName, { maxLength: 100 }) : null,
    eventType: null,
  };
}

/**
 * Runs a single blueprint against an event, returning a translated event or
 * null when the blueprint cannot handle it.
 */
function applyBlueprint(event: RawEvent, blueprint: TranslationBlueprint, lang: Language): TranslatedEvent | null {
  if (blueprint.matches && !blueprint.matches(event)) return null;

  const result = blueprint.translate(event, lang);
  if (!result) return null;

  return {
    raw: event,
    description: result.description ? sanitizeTextField(result.description) : null,
    status: "translated",
    blueprintName: blueprint.contractName,
    eventType: result.eventType ? sanitizeTextField(result.eventType, { maxLength: 64 }) : null,
    schemaVersion: (blueprint as any).version ?? null,
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
 * Performance notes
 * ─────────────────
 * - Pre-allocates the result array to avoid dynamic resizing.
 * - The try/catch is lifted outside the hot loop into a wrapper so V8 can
 *   optimise the inner translateEvent() call independently. A try/catch inside
 *   a tight loop prevents the enclosing function from being optimised by
 *   TurboFan (the V8 JIT compiler).
 *
 * @param customBlueprints Optional per-session blueprints (e.g. uploaded ABIs)
 *   that are consulted before the global registry.
 */
export function translateEvents(
  events: RawEvent[],
  customBlueprints?: Map<string, TranslationBlueprint>,
  lang: Language = "en"
): TranslatedEvent[] {
  // Pre-allocate the result array — avoids incremental resizing on every push.
  const results: TranslatedEvent[] = new Array(events.length);
  for (let i = 0; i < events.length; i++) {
    results[i] = translateEventSafe(events[i], customBlueprints, lang);
  }
  return results;
}

/**
 * Thin wrapper that isolates the try/catch from the hot loop in translateEvents.
 * V8 TurboFan cannot optimise a function that contains a try/catch that wraps a
 * loop, but it CAN optimise the callee — so we separate the concerns.
 */
function translateEventSafe(
  event: RawEvent,
  customBlueprints: Map<string, TranslationBlueprint> | undefined,
  lang: Language
): TranslatedEvent {
  try {
    return translateEvent(event, customBlueprints, lang);
  } catch (error) {
    const templateError = new RegistryTemplateException(
      error instanceof Error ? error.message : "Translation failed",
      {
        contractId: event.contractId,
        ledgerSequence: event.ledger,
        xdrHex: event.data,
        txHash: event.txHash,
        operation: "translateEvent",
      },
      error
    );
    captureExceptionSync(templateError);

    return {
      raw: event,
      description: null,
      status: "cryptic",
      blueprintName: null,
      eventType: null,
      schemaVersion: null,
    };
  }
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

/**
 * Registers one or more versioned blueprints for a contract at runtime.
 *
 * Call this to add or upgrade a contract's translation schemas without
 * rebuilding the singleton. The blueprint list is re-sorted after insertion.
 */
export function registerBlueprint(...blueprints: VersionedTranslationBlueprint[]): void {
  for (const blueprint of blueprints) {
    const existing = REGISTRY.get(blueprint.contractId) ?? [];
    existing.push(blueprint);
    REGISTRY.set(
      blueprint.contractId,
      existing.sort((a, b) => (b.validFromLedger ?? 0) - (a.validFromLedger ?? 0))
    );
  }
}