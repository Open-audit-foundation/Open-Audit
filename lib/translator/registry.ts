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
import { decodeGenericEventPayload, formatGenericValue } from "./generic-fallback-decoder";
import { RegistryTemplateException } from "../errors";
import { captureExceptionSync } from "../telemetry";
import { getCachedTranslation, setCachedTranslation, isRedisEnabled } from "../cache/redisCache";
import type {
  EventMatchCriteria,
  RawEvent,
  TranslatedEvent,
  TranslationBlueprint,
  VersionedTranslationBlueprint,
  Language,
  ContractSchema,
  ContractRegistryEntry,
} from "./types";

/** The registry maps contract IDs to their versioned entries. */
type BlueprintRegistry = Map<string, ContractRegistryEntry>;

/** Cache for resolved schemas to avoid repeated scans of the registry. */
const RESOLUTION_CACHE: Map<string, ContractSchema> = new Map();

export type PersistedRawEvent = RawEvent &
  Partial<
    Pick<
      TranslatedEvent,
      "description" | "status" | "blueprintName" | "eventType" | "schemaVersion"
    >
  >;

function hasPersistedTranslation(event: PersistedRawEvent): boolean {
  return (
    event.status !== undefined ||
    event.description !== undefined ||
    event.blueprintName !== undefined ||
    event.eventType !== undefined ||
    event.schemaVersion !== undefined
  );
}

function buildTranslationFromPersisted(event: PersistedRawEvent): TranslatedEvent {
  return {
    raw: event,
    description: event.description ?? null,
    status: event.status ?? "cryptic",
    blueprintName: event.blueprintName ?? null,
    eventType: event.eventType ?? null,
    schemaVersion: event.schemaVersion ?? null,
  };
}

export async function translateWithCache(
  event: PersistedRawEvent,
  customBlueprints?: Map<string, TranslationBlueprint>,
  lang: Language = "en"
): Promise<TranslatedEvent> {
  if (event.txHash && event.id && isRedisEnabled()) {
    const cached = await getCachedTranslation(event);
    if (cached) return cached;
  }

  const translated =
    hasPersistedTranslation(event) && event.status !== undefined
      ? buildTranslationFromPersisted(event)
      : translateEvent(event, customBlueprints, lang);

  if (event.txHash && event.id && isRedisEnabled()) {
    await setCachedTranslation(event, translated);
  }

  return translated;
}

/**
 * Builds the global blueprint registry by collecting all known blueprints.
 * Add new blueprints here as the community contributes them.
 */
function buildRegistry(): BlueprintRegistry {
  const registry: BlueprintRegistry = new Map();

  /** Helper to add or merge a blueprint into the registry with versioning. */
  function register(blueprint: TranslationBlueprint, version = "1.0.0", fromLedger = 0) {
    let entry = registry.get(blueprint.contractId);
    if (!entry) {
      entry = {
        contractId: blueprint.contractId,
        contractName: blueprint.contractName,
        schemas: [],
      };
      registry.set(blueprint.contractId, entry);
    }

    entry.schemas.push({
      version,
      validFromLedger: fromLedger,
      validToLedger: null,
      blueprint,
    });

    entry.schemas.sort((a, b) => a.validFromLedger - b.validFromLedger);
    for (let i = 0; i < entry.schemas.length - 1; i++) {
      entry.schemas[i].validToLedger = entry.schemas[i + 1].validFromLedger - 1;
    }
  }

  // 1. Load Hardcoded Blueprints
  for (const blueprint of createAllSacBlueprints()) {
    register(blueprint);
  }

  // 2. Register mint/burn blueprints for known SAC contracts.
  // When a SAC transfer blueprint already exists for the same contract,
  // create a merged blueprint that tries the transfer translation first
  // and falls back to mint/burn.
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
      // Merge: extend the latest schema's blueprint so it also handles
      // mint/burn events that the original transfer-only blueprint misses.
      const latestSchema = existing.schemas[existing.schemas.length - 1];
      const originalTranslate = latestSchema.blueprint.translate.bind(latestSchema.blueprint);
      const mergedBlueprint: TranslationBlueprint = {
        ...latestSchema.blueprint,
        translate: (event, lang) =>
          originalTranslate(event, lang) ?? mintBurnBlueprint.translate(event, lang),
      };
      latestSchema.blueprint = mergedBlueprint;
    } else {
      register(mintBurnBlueprint);
    }
  }

  return registry;
}

/**
 * Dynamically registers a new schema for a contract, using a simple
 * field-mapping array (as supplied by registerUpgrade callers).
 *
 * Useful for handling contract upgrades (update_current_contract_wasm) at runtime.
 */
export function registerUpgrade(
  contractId: string,
  version: string,
  fromLedger: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  eventMappings: any[]
): void {
  const entry = REGISTRY.get(contractId);
  if (!entry) return;

  const blueprint: TranslationBlueprint = {
    contractId,
    contractName: entry.contractName,
    translate: (event, lang) => {
      for (const mapping of eventMappings) {
        const result = createTranslateFromMapping(mapping)(event, lang);
        if (result) return result;
      }
      return null;
    },
  };

  entry.schemas.push({
    version,
    validFromLedger: fromLedger,
    validToLedger: null,
    blueprint,
  });

  entry.schemas.sort((a, b) => a.validFromLedger - b.validFromLedger);
  for (let i = 0; i < entry.schemas.length - 1; i++) {
    entry.schemas[i].validToLedger = entry.schemas[i + 1].validFromLedger - 1;
  }

  // Clear cache for this contract to force re-resolution.
  for (const key of Array.from(RESOLUTION_CACHE.keys())) {
    if (key.startsWith(`${contractId}:`)) {
      RESOLUTION_CACHE.delete(key);
    }
  }
}

/**
 * Creates a translate function from a simple field-mapping descriptor.
 * Used by registerUpgrade to support dynamic schema registration at runtime.
 */
function createTranslateFromMapping(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mapping: any
): TranslationBlueprint["translate"] {
  return (event) => {
    // Match on the first topic (event name)
    const eventName = event.topics[0] ? decodeEventNameFromTopic(event.topics[0]) : null;
    if (!mapping.topics || !mapping.topics.includes(eventName)) return null;

    // Build params from event_structure field mapping
    const params: Record<string, string> = {};
    if (mapping.event_structure?.topics) {
      for (let i = 0; i < mapping.event_structure.topics.length; i++) {
        const field = mapping.event_structure.topics[i];
        const topicVal = event.topics[i + 1] ?? "";
        params[`${field.name}.short`] = topicVal.slice(0, 10);
        params[field.name] = topicVal;
      }
    }
    if (mapping.event_structure?.data) {
      params[mapping.event_structure.data.name] = event.data;
    }

    // Simple template interpolation
    let description = mapping.english_template ?? "";
    for (const [key, val] of Object.entries(params)) {
      description = description.replace(new RegExp(`\\{${key}\\}`, "g"), String(val));
    }

    return { description, eventType: mapping.topics?.[0] ?? "Event" };
  };
}

/** Decodes a hex-encoded topic to its ASCII string name, if possible. */
function decodeEventNameFromTopic(topic: string): string | null {
  try {
    const hex = topic.startsWith("0x") ? topic.slice(2) : topic;
    const clean = hex.replace(/^0+/, "");
    if (!clean) return null;
    // Each hex pair is a byte; try to decode as UTF-8.
    const bytes = Buffer.from(clean, "hex");
    const str = bytes.toString("utf8");
    // Only accept printable ASCII strings.
    if (/^[\x20-\x7E]+$/.test(str)) return str;
    return null;
  } catch {
    return null;
  }
}

/** Singleton registry instance. */
const REGISTRY: BlueprintRegistry = buildRegistry();

/**
 * Resolves the correct schema version for a given contract and ledger.
 * Returns null if no matching entry exists.
 */
function resolveSchema(
  contractId: string,
  ledger: number,
  customBlueprints?: Map<string, TranslationBlueprint>
): ContractSchema | null {
  // 1. Check custom (session-local) blueprints first.
  //    Custom blueprints are not versioned — treat them as always valid.
  const custom = customBlueprints?.get(contractId);
  if (custom) {
    return {
      version: "custom",
      validFromLedger: 0,
      validToLedger: null,
      blueprint: custom,
    };
  }

  // 2. Check resolution cache.
  const cacheKey = `${contractId}:${ledger}`;
  const cached = RESOLUTION_CACHE.get(cacheKey);
  if (cached) return cached;

  // 3. Look up in global registry.
  const entry = REGISTRY.get(contractId);
  if (!entry) return null;

  // 4. Find the schema window that contains this ledger.
  const schema = entry.schemas.find(
    (s) =>
      ledger >= s.validFromLedger &&
      (s.validToLedger === null || ledger <= s.validToLedger)
  );

  if (schema) {
    RESOLUTION_CACHE.set(cacheKey, schema);
    return schema;
  }

  return null;
}

/**
 * Translates a single raw Soroban event into a human-readable TranslatedEvent.
 */
export function translateEvent(
  event: RawEvent,
  customBlueprints?: Map<string, TranslationBlueprint>,
  lang: Language = "en"
): TranslatedEvent {
  const schema = resolveSchema(event.contractId, event.ledger, customBlueprints);

  if (!schema) {
    // No blueprint registered for this contract — use the generic fallback decoder.
    console.warn(`No translation blueprint found for contract ${event.contractId}`);

    const genericDecoded = decodeGenericEventPayload(event);
    const description = genericDecoded
      ? `[Unregistered Contract] ${formatGenericValue(genericDecoded)}`
      : `[Unknown Event: No blueprint registered for contract ${event.contractId}. Hex Data: ${event.data}]`;

    return {
      raw: event,
      description: sanitizeTextField(description, { maxLength: 512 }),
      status: "cryptic",
      blueprintName: "Unregistered Contract",
      eventType: null,
      schemaVersion: null,
    };
  }

  const translated = applyBlueprint(event, schema.blueprint, lang);
  if (translated) {
    // Attach the schema version label to the translated event.
    return { ...translated, schemaVersion: schema.version ?? null };
  }

  return {
    raw: event,
    description: null,
    status: "cryptic",
    blueprintName: schema.blueprint.contractName,
    eventType: null,
    schemaVersion: schema.version ?? null,
  };
}

/**
 * Runs a single blueprint against an event, returning a TranslatedEvent or
 * null when the blueprint cannot handle it.
 */
function applyBlueprint(
  event: RawEvent,
  blueprint: TranslationBlueprint,
  lang: Language
): TranslatedEvent | null {
  if (blueprint.matches && !blueprint.matches(event)) return null;

  const result = blueprint.translate(event, lang);
  if (!result) return null;

  return {
    raw: event,
    description: result.description ? sanitizeTextField(result.description) : null,
    status: "translated",
    blueprintName: blueprint.contractName,
    eventType: result.eventType
      ? sanitizeTextField(result.eventType, { maxLength: 64 })
      : null,
    schemaVersion: null, // filled in by translateEvent after resolving the schema version
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

    if (topicCriteria.decodedName && decodeEventName(topic) !== topicCriteria.decodedName) {
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
 * Registers one or more blueprints for a contract at runtime.
 *
 * If an entry already exists for the contract, the blueprint is added as a
 * new schema version (fromLedger = 0 by default — it becomes the baseline).
 * Call registerUpgrade() instead when registering a contract upgrade.
 */
export function registerBlueprint(...blueprints: TranslationBlueprint[]): void {
  for (const blueprint of blueprints) {
    const existing = REGISTRY.get(blueprint.contractId);
    if (!existing) {
      REGISTRY.set(blueprint.contractId, {
        contractId: blueprint.contractId,
        contractName: blueprint.contractName,
        schemas: [
          {
            version: "1.0.0",
            validFromLedger: 0,
            validToLedger: null,
            blueprint,
          },
        ],
      });
    } else {
      // Add as a new schema version at fromLedger = 0 only if no schema exists
      // at that ledger yet; otherwise treat as replacing the baseline.
      const versionedBp = blueprint as VersionedTranslationBlueprint;
      const fromLedger = versionedBp.validFromLedger ?? 0;
      existing.schemas.push({
        version: versionedBp.version ?? "1.0.0",
        validFromLedger: fromLedger,
        validToLedger: null,
        blueprint,
      });
      existing.schemas.sort((a, b) => a.validFromLedger - b.validFromLedger);
      for (let i = 0; i < existing.schemas.length - 1; i++) {
        existing.schemas[i].validToLedger = existing.schemas[i + 1].validFromLedger - 1;
      }
    }

    // Clear any cached resolutions for this contract so the new schema is picked up.
    for (const key of Array.from(RESOLUTION_CACHE.keys())) {
      if (key.startsWith(`${blueprint.contractId}:`)) {
        RESOLUTION_CACHE.delete(key);
      }
    }
  }
}
