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
import { decodeEventName, decodeAddress, decodeAmount, interpolateTemplate, sanitizeTextField } from "./core";
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
  TranslationResult,
  BlueprintStatus,
} from "./types";

/** The registry maps contract IDs to their versioned entries. */
type BlueprintRegistry = Map<string, ContractRegistryEntry>;

/** Cache for resolved schemas to avoid repeated scans of the registry. */
const RESOLUTION_CACHE: Map<string, ContractSchema> = new Map();


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
        owner: blueprint.owner,
        maintainers: blueprint.maintainers,
        status: blueprint.status ?? "active",
        schemas: [],
      };
      registry.set(blueprint.contractId, entry);
    } else {
      if (blueprint.owner) entry.owner = blueprint.owner;
      if (blueprint.maintainers) entry.maintainers = blueprint.maintainers;
      if (blueprint.status) entry.status = blueprint.status;
    }

    entry.schemas.push({
      version,
      validFromLedger: fromLedger,
      validToLedger: null,
      blueprint,
      owner: blueprint.owner,
      maintainers: blueprint.maintainers,
      status: blueprint.status ?? "active",
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
      for (const schema of existing.schemas) {
        const originalTranslate = schema.blueprint.translate.bind(schema.blueprint);
        schema.blueprint.translate = (event, lang) => originalTranslate(event, lang) ?? mintBurnBlueprint.translate(event, lang);
      }
    } else {
      register(mintBurnBlueprint);
    }
  }

  return registry;
}

function createTranslateFromMapping(mapping: any) {
  return (event: RawEvent, lang: Language): TranslationResult | null => {
    const topic0 = event.topics[0] ?? "";
    const decodedName = decodeEventName(topic0);
    const expectedTopics = mapping.topics ?? [];
    if (expectedTopics.length > 0) {
      const expected = expectedTopics[0];
      if (
        decodedName !== expected &&
        topic0 !== expected &&
        !topic0.toLowerCase().includes(Buffer.from(expected).toString("hex"))
      ) {
        return null;
      }
    }

    const params: Record<string, string> = {};
    const structure = mapping.event_structure ?? {};

    // Topics mapping
    const topicFields = structure.topics ?? [];
    topicFields.forEach((field: any, idx: number) => {
      const hex = event.topics[idx + 1] ?? "0x00";
      const name = field.name;
      const type = field.type;
      if (type === "address") {
        const addr = decodeAddress(hex);
        params[name] = addr.publicKey || hex;
        params[`${name}.short`] = addr.short || hex;
      } else if (
        ["i128", "u128", "i64", "u64", "u32", "i32"].includes(type)
      ) {
        const amt = decodeAmount(hex);
        params[name] = amt.formatted;
        params[`${name}.formatted`] = amt.formatted;
      } else {
        params[name] = hex;
      }
    });

    // Data mapping
    const dataField = structure.data;
    if (dataField && typeof dataField === "object") {
      const hex = event.data ?? "0x00";
      const name = dataField.name;
      const type = dataField.type;
      if (type === "address") {
        const addr = decodeAddress(hex);
        params[name] = addr.publicKey || hex;
        params[`${name}.short`] = addr.short || hex;
      } else if (
        ["i128", "u128", "i64", "u64", "u32", "i32"].includes(type)
      ) {
        const amt = decodeAmount(hex);
        params[name] = amt.formatted;
        params[`${name}.formatted`] = amt.formatted;
      } else {
        params[name] = hex;
      }
    }

    const template =
      mapping.templates?.[lang] ??
      mapping.templates?.en ??
      mapping.english_template ??
      "";
    if (!template) return null;

    const description = interpolateTemplate(template, params);
    const eventType = expectedTopics[0]
      ? expectedTopics[0].charAt(0).toUpperCase() + expectedTopics[0].slice(1)
      : "Event";

    return {
      description,
      eventType,
    };
  };
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
function resolveSchema(
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
  if (cached) return cached;

  // 3. Look up in global registry
  const entry = REGISTRY.get(contractId);
  if (!entry) return null;

  // 4. Find matching ledger window
  const schema = entry.schemas.find(
    (s) => ledger >= s.validFromLedger && (s.validToLedger === null || ledger <= s.validToLedger)
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
    console.warn(`No translation blueprint found for contract ${event.contractId}`);
    
    // Try to decode the event using the generic fallback decoder
    const genericDecoded = decodeGenericEventPayload(event);
    const description = genericDecoded
      ? `[Unregistered Contract] ${formatGenericValue(genericDecoded)}`
      : `[Unknown Event: No blueprint registered for contract ${event.contractId}. Hex Data: ${event.data}]`;
    
    const entry = REGISTRY.get(event.contractId);
    const custom = customBlueprints?.get(event.contractId);
    const contractName = custom?.contractName ?? entry?.contractName;

    return {
      raw: event,
      description: sanitizeTextField(description, { maxLength: 512 }),
      status: "cryptic",
      blueprintName: contractName ? sanitizeTextField(contractName, { maxLength: 100 }) : "Unregistered Contract",
      eventType: null,
      schemaVersion: null,
      blueprintStatus: entry?.status ?? custom?.status ?? "active",
      blueprintOwner: entry?.owner ?? custom?.owner,
    };
  }

  const entry = REGISTRY.get(event.contractId);
  const blueprint = schema.blueprint;
  const translated = applyBlueprint(event, blueprint, lang);
  const resolvedStatus = schema.status ?? schema.blueprint.status ?? entry?.status ?? "active";
  const resolvedOwner = schema.owner ?? schema.blueprint.owner ?? entry?.owner;

  if (translated) {
    return {
      ...translated,
      schemaVersion: schema.version === "custom" ? null : schema.version,
      blueprintStatus: resolvedStatus,
      blueprintOwner: resolvedOwner,
    };
  }

  return {
    raw: event,
    description: null,
    status: "cryptic",
    blueprintName: blueprint.contractName,
    eventType: null,
    schemaVersion: schema.version === "custom" ? null : schema.version,
    blueprintStatus: resolvedStatus,
    blueprintOwner: resolvedOwner,
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
    blueprintStatus: blueprint.status ?? "active",
    blueprintOwner: blueprint.owner,
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
export function registerBlueprint(...blueprints: TranslationBlueprint[]): void {
  for (const blueprint of blueprints) {
    const versioned = blueprint as VersionedTranslationBlueprint;
    const version = versioned.version ?? "1.0.0";
    const fromLedger = versioned.validFromLedger ?? 0;

    let entry = REGISTRY.get(blueprint.contractId);
    if (!entry) {
      entry = {
        contractId: blueprint.contractId,
        contractName: blueprint.contractName,
        owner: blueprint.owner,
        maintainers: blueprint.maintainers,
        status: blueprint.status ?? "active",
        schemas: [],
      };
      REGISTRY.set(blueprint.contractId, entry);
    } else {
      if (blueprint.owner) entry.owner = blueprint.owner;
      if (blueprint.maintainers) entry.maintainers = blueprint.maintainers;
      if (blueprint.status) entry.status = blueprint.status;
    }

    entry.schemas.push({
      version,
      validFromLedger: fromLedger,
      validToLedger: null,
      blueprint,
      owner: blueprint.owner,
      maintainers: blueprint.maintainers,
      status: blueprint.status ?? "active",
    });

    entry.schemas.sort((a, b) => a.validFromLedger - b.validFromLedger);
    for (let i = 0; i < entry.schemas.length - 1; i++) {
      entry.schemas[i].validToLedger = entry.schemas[i + 1].validFromLedger - 1;
    }

    RESOLUTION_CACHE.forEach((_, key) => {
      if (key.startsWith(`${blueprint.contractId}:`)) {
        RESOLUTION_CACHE.delete(key);
      }
    });
  }
}

/**
 * Returns the registry entry for a contract ID, including its schemas, ownership, and deprecation status.
 */
export function getContractRegistryEntry(contractId: string): ContractRegistryEntry | undefined {
  return REGISTRY.get(contractId);
}

/**
 * Updates the deprecation status or ownership metadata of a registered contract.
 */
export function updateContractMetadata(
  contractId: string,
  metadata: { owner?: string; maintainers?: string[]; status?: BlueprintStatus }
): boolean {
  const entry = REGISTRY.get(contractId);
  if (!entry) return false;

  if (metadata.owner !== undefined) entry.owner = metadata.owner;
  if (metadata.maintainers !== undefined) entry.maintainers = metadata.maintainers;
  if (metadata.status !== undefined) entry.status = metadata.status;

  for (const schema of entry.schemas) {
    if (metadata.owner !== undefined) schema.owner = metadata.owner;
    if (metadata.maintainers !== undefined) schema.maintainers = metadata.maintainers;
    if (metadata.status !== undefined) schema.status = metadata.status;
  }

  // Clear cache for this contract
  RESOLUTION_CACHE.forEach((_, key) => {
    if (key.startsWith(`${contractId}:`)) {
      RESOLUTION_CACHE.delete(key);
    }
  });

  return true;
}