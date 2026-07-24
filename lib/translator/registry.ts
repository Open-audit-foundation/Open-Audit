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
import { createAllSdexBlueprints } from "./blueprints/sdex-orderbook";
import {
  registryCacheHitsTotal,
  registryCacheMissesTotal,
  translationsTotal,
} from "../metrics";
import {
  decodeEventName,
  sanitizeTextField,
  decodeAddress,
  decodeAmount,
  interpolateTemplate,
} from "./core";
import { decodeGenericEventPayload, formatGenericValue } from "./generic-fallback-decoder";
import { getTranslation } from "./translations";
import { RegistryTemplateException } from "../errors";
import type {
  EventMatchCriteria,
  RawEvent,
  TranslatedEvent,
  TranslationBlueprint,
  VersionedTranslationBlueprint,
  Language,
  ContractSchema,
  ContractRegistryEntry,
  TranslationResult,
} from "./types";

/** The registry maps contract IDs to their versioned entries. */
type BlueprintRegistry = Map<string, ContractRegistryEntry>;

/** Cache for resolved schemas to avoid repeated scans of the registry. */
const RESOLUTION_CACHE_MAX = 1024; // bounded: evict oldest at capacity
const RESOLUTION_CACHE: Map<string, ContractSchema> = new Map();

function cacheResolvedSchema(key: string, schema: ContractSchema): void {
  RESOLUTION_CACHE.set(key, schema);
  if (RESOLUTION_CACHE.size > RESOLUTION_CACHE_MAX) {
    const oldest = RESOLUTION_CACHE.keys().next().value;
    if (oldest !== undefined) RESOLUTION_CACHE.delete(oldest);
  }
}

export function getResolutionCacheSize(): number {
  return RESOLUTION_CACHE.size;
}

export function getResolutionCacheMax(): number {
  return RESOLUTION_CACHE_MAX;
}

/**
 * Interpolates a template string with values from an object.
 * e.g. "Hello {name}" + { name: "World" } -> "Hello World"
 */
export type PersistedRawEvent = RawEvent & Partial<Pick<TranslatedEvent, "description" | "status" | "blueprintName" | "eventType" | "schemaVersion">>;

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

async function getCachedTranslationIfAvailable(
  event: Pick<RawEvent, "txHash" | "id">
): Promise<TranslatedEvent | null> {
  if (typeof window !== "undefined") {
    return null;
  }

  const { getCachedTranslation, isRedisEnabled } = await import("../cache/redisCache");
  if (!isRedisEnabled()) {
    return null;
  }

  return getCachedTranslation(event);
}

async function setCachedTranslationIfAvailable(
  event: Pick<RawEvent, "txHash" | "id">,
  translated: TranslatedEvent
): Promise<void> {
  if (typeof window !== "undefined") {
    return;
  }

  const { setCachedTranslation, isRedisEnabled } = await import("../cache/redisCache");
  if (!isRedisEnabled()) {
    return;
  }

  await setCachedTranslation(event, translated);
}

function captureTemplateError(error: RegistryTemplateException): void {
  console.error("[open-audit:registry]", error);
}

export async function translateWithCache(
  event: PersistedRawEvent,
  customBlueprints?: Map<string, TranslationBlueprint>,
  lang: Language = "en"
): Promise<TranslatedEvent> {
  if (event.txHash && event.id) {
    const cached = await getCachedTranslationIfAvailable(event);
    if (cached) return cached;
  }

  const translated =
    hasPersistedTranslation(event) && event.status !== undefined
      ? buildTranslationFromPersisted(event)
      : translateEvent(event, customBlueprints, lang);

  if (event.txHash && event.id) {
    await setCachedTranslationIfAvailable(event, translated);
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
      const existingBlueprint = existing.schemas?.[0]?.blueprint;
      if (existingBlueprint) {
        const wrappedBlueprint: TranslationBlueprint = {
          contractId: existingBlueprint.contractId,
          contractName: existingBlueprint.contractName,
          matches: existingBlueprint.matches,
          translate: (event, lang) => {
            const originalResult = existingBlueprint.translate(event, lang);
            if (originalResult) return originalResult;
            return mintBurnBlueprint.translate(event, lang);
          },
        };
        // Replace the existing schema's blueprint
        existing.schemas[0].blueprint = wrappedBlueprint;
      }
    } else {
      register(mintBurnBlueprint);
    }
  }

  // 3. Load SDEX (Stellar Classic Order Book) Blueprints
  for (const blueprint of createAllSdexBlueprints()) {
    register(blueprint);
  }

  return registry;
}

/**
 * Builds a `translate` function from a single event-mapping declaration.
 * Called by registerUpgrade (eventMappings). Required for the module to load.
 */
function createTranslateFromMapping(
  mapping: any
): (event: RawEvent, lang: Language) => TranslationResult | null {
  const matchNames: string[] = Array.isArray(mapping.topics) ? mapping.topics : [];
  const topicFields: any[] = mapping.event_structure?.topics ?? [];
  const dataField: any = mapping.event_structure?.data ?? null;
  const template: string = mapping.english_template ?? "";

  return (event: RawEvent, _lang: Language): TranslationResult | null => {
    const eventName = decodeEventName(event.topics[0] ?? "");
    if (matchNames.length > 0 && !matchNames.includes(eventName)) return null;

    const params: Record<string, string> = {};
    topicFields.forEach((field: any, idx: number) => {
      const hex = event.topics[idx + 1] ?? "";
      const decoded = decodeField(hex, field.type);
      params[field.name] = decoded.full;
      params[`${field.name}.short`] = decoded.short;
    });
    if (dataField) {
      const decoded = decodeField(event.data ?? "", dataField.type);
      params[dataField.name] = decoded.full;
      params[`${dataField.name}.short`] = decoded.short;
    }

    const description = interpolateTemplate(template, params);
    if (!description) return null;
    return { description, eventType: matchNames[0] ?? eventName };
  };
}

function decodeField(hex: string, type: string): { full: string; short: string } {
  switch (type) {
    case "address": {
      const addr = decodeAddress(hex);
      return { full: addr.publicKey, short: addr.short };
    }
    case "i128":
    case "i64":
    case "u64":
    case "u128":
    case "amount": {
      const amt = decodeAmount(hex);
      return { full: `${amt.formatted} ${amt.symbol}`.trim(), short: amt.formatted };
    }
    default:
      return { full: hex, short: hex.slice(0, 10) };
  }
}

/**
 * Dynamically registers a new schema for a contract.
 * Useful for handling contract upgrades (update_current_contract_wasm) at runtime.
 */
export function registerUpgrade(
  contractId: string,
  version: string,
  fromLedger: number,
  eventMappings: any[]
) {
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

  // Clear cache for this contract to force re-resolution
  RESOLUTION_CACHE.forEach((_, key) => {
    if (key.startsWith(`${contractId}:`)) {
      RESOLUTION_CACHE.delete(key);
    }
  });
}

/** Singleton registry instance. */
const REGISTRY: BlueprintRegistry = buildRegistry();

/**
 * Resolves the correct schema version for a given contract and ledger.
 */
export function resolveSchema(
  contractId: string,
  ledger: number,
  customBlueprints?: Map<string, TranslationBlueprint>
): ContractSchema | null {
  // 1. Check Custom (local) blueprints first. 
  // Custom blueprints are currently not versioned in this implementation, 
  // but we treat them as "always valid" for the current session.
  const custom = customBlueprints?.get(contractId);
  if (custom) {
    return {
      version: "custom",
      validFromLedger: 0,
      validToLedger: null,
      blueprint: custom,
    };
  }

  // 2. Check cache
  const cacheKey = `${contractId}:${ledger}`;
  const cached = RESOLUTION_CACHE.get(cacheKey);
  if (cached) {
    registryCacheHitsTotal.inc();
    return cached;
  }
  registryCacheMissesTotal.inc();

  // 3. Look up in global registry
  const entry = REGISTRY.get(contractId);
  if (!entry) return null;

  // 4. Find matching ledger window
  const schema = entry.schemas.find(
    (s) => ledger >= s.validFromLedger && (s.validToLedger === null || ledger <= s.validToLedger)
  );

  if (schema) {
    cacheResolvedSchema(cacheKey, schema);
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
    console.warn(`No translation blueprint found for contract ${event.contractId}`);

    const t = getTranslation(lang);

    // Try to decode the event using the generic fallback decoder
    const genericDecoded = decodeGenericEventPayload(event, lang);
    const description = genericDecoded
      ? t.generic.unregisteredContractDescription(formatGenericValue(genericDecoded))
      : t.generic.unknownEventNoBlueprint(event.contractId, event.data);

    return {
      raw: event,
      description: sanitizeTextField(description, { maxLength: 512 }),
      status: "cryptic",
      // Surface the custom contract name (if any) so the UI still has context.
      blueprintName: customBlueprints?.get(event.contractId)?.contractName
        ? sanitizeTextField(customBlueprints.get(event.contractId)!.contractName, { maxLength: 100 })
        : t.generic.unregisteredContractName,
      eventType: null,
      schemaVersion: null,
    };
  }

  const blueprint = schema.blueprint;

  if (!blueprint) {
    console.warn(`No translation blueprint applicable for contract ${event.contractId} at ledger ${event.ledger}`);
    const t = getTranslation(lang);
    return {
      raw: event,
      description: t.generic.unknownEventNoBlueprintApplicable(event.contractId, event.ledger, event.data),
      status: "cryptic",
      blueprintName: schema.blueprint.contractName,
      eventType: null,
      schemaVersion: null,
    };
  }

  const translated = applyBlueprint(event, blueprint, lang);
  if (translated) return translated;

  return {
    raw: event,
    description: null,
    status: "cryptic",
    blueprintName: schema.blueprint.contractName,
    eventType: null,
    schemaVersion: null,
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
    const result = translateEvent(event, customBlueprints, lang);
    translationsTotal.inc({ status: result.status ?? "cryptic" });
    return result;
  } catch (error) {
    translationsTotal.inc({ status: "cryptic" });
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
    captureTemplateError(templateError);

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
export function registerBlueprint(...blueprints: TranslationBlueprint[]): void {
  for (const blueprint of blueprints) {
    const schema: ContractSchema = {
      version: "1.0.0",
      validFromLedger: blueprint.validFromLedger ?? 1,
      validToLedger: null,
      blueprint,
    };
    const existing = REGISTRY.get(blueprint.contractId);
    if (!existing) {
      const entry: ContractRegistryEntry = {
        contractId: blueprint.contractId,
        contractName: blueprint.contractName,
        schemas: [schema],
      };
      REGISTRY.set(blueprint.contractId, entry);
      continue;
    }

    // Merge into existing entry's schemas list, keeping ledger-order.
    const entry = Array.isArray(existing)
      ? (existing[0] as unknown as ContractRegistryEntry)
      : (existing as ContractRegistryEntry);
    const mergedSchemas = [...(entry.schemas ?? []), schema].sort(
      (a, b) => (a.validFromLedger ?? 0) - (b.validFromLedger ?? 0)
    );
    REGISTRY.set(blueprint.contractId, {
      contractId: blueprint.contractId,
      contractName: blueprint.contractName,
      schemas: mergedSchemas,
    });
  }
}
