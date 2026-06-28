/** The Open-Audit Translation Registry. */

import { createAllSacBlueprints } from "./blueprints/sac-transfer";
import { createSacMintBurnBlueprint } from "./blueprints/sac-mint-burn";
import { decodeEventName, sanitizeTextField } from "./core";
import { decodeGenericEventPayload, formatGenericValue } from "./generic-fallback-decoder";
import { RegistryTemplateException } from "../errors";
import { captureExceptionSync } from "../telemetry";
import { getCachedTranslation, setCachedTranslation, isRedisEnabled } from "../cache/redisCache";
import { assertBlueprintSchemaVersion, BLUEPRINT_SCHEMA_VERSION } from "./schema-version";
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

type BlueprintRegistry = Map<string, ContractRegistryEntry>;
const RESOLUTION_CACHE: Map<string, ContractSchema> = new Map();

export type PersistedRawEvent = RawEvent & Partial<Pick<TranslatedEvent, "description" | "status" | "blueprintName" | "eventType" | "schemaVersion">>;

function hasPersistedTranslation(event: PersistedRawEvent): boolean {
  return event.status !== undefined || event.description !== undefined || event.blueprintName !== undefined || event.eventType !== undefined || event.schemaVersion !== undefined;
}

function buildTranslationFromPersisted(event: PersistedRawEvent): TranslatedEvent {
  return { raw: event, description: event.description ?? null, status: event.status ?? "cryptic", blueprintName: event.blueprintName ?? null, eventType: event.eventType ?? null, schemaVersion: event.schemaVersion ?? null };
}

export async function translateWithCache(event: PersistedRawEvent, customBlueprints?: Map<string, TranslationBlueprint>, lang: Language = "en"): Promise<TranslatedEvent> {
  if (event.txHash && event.id && isRedisEnabled()) {
    const cached = await getCachedTranslation(event);
    if (cached) return cached;
  }
  const translated = hasPersistedTranslation(event) && event.status !== undefined ? buildTranslationFromPersisted(event) : translateEvent(event, customBlueprints, lang);
  if (event.txHash && event.id && isRedisEnabled()) await setCachedTranslation(event, translated);
  return translated;
}

function normalizeBlueprint(blueprint: TranslationBlueprint, version = "1.0.0", fromLedger = 0): ContractSchema {
  assertBlueprintSchemaVersion(blueprint);
  return { version, validFromLedger: fromLedger, validToLedger: null, blueprint };
}

function sortAndCloseSchemas(entry: ContractRegistryEntry): void {
  entry.schemas.sort((a, b) => a.validFromLedger - b.validFromLedger);
  for (let i = 0; i < entry.schemas.length; i++) {
    entry.schemas[i].validToLedger = i < entry.schemas.length - 1 ? entry.schemas[i + 1].validFromLedger - 1 : null;
  }
}

function addSchema(registry: BlueprintRegistry, blueprint: TranslationBlueprint, version = "1.0.0", fromLedger = 0): void {
  let entry = registry.get(blueprint.contractId);
  if (!entry) {
    entry = { contractId: blueprint.contractId, contractName: blueprint.contractName, schemas: [] };
    registry.set(blueprint.contractId, entry);
  }
  entry.schemas.push(normalizeBlueprint(blueprint, version, fromLedger));
  sortAndCloseSchemas(entry);
}

function buildRegistry(): BlueprintRegistry {
  const registry: BlueprintRegistry = new Map();
  for (const blueprint of createAllSacBlueprints()) addSchema(registry, blueprint);

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
      const transferBlueprint = existing.schemas[0].blueprint;
      const combined: TranslationBlueprint = {
        ...mintBurnBlueprint,
        contractName: transferBlueprint.contractName,
        translate: (event, lang) => transferBlueprint.translate(event, lang) ?? mintBurnBlueprint.translate(event, lang),
      };
      existing.schemas = [normalizeBlueprint(combined)];
    } else {
      addSchema(registry, mintBurnBlueprint);
    }
  }
  return registry;
}

const REGISTRY: BlueprintRegistry = buildRegistry();

function createTranslateFromMapping(mapping: any): (event: RawEvent, lang: Language) => TranslationResult | null {
  return (event: RawEvent) => {
    const expected = mapping.topics?.[0];
    if (expected && decodeEventName(event.topics[0] ?? "") !== expected && !String(event.topics[0] ?? "").includes(Buffer.from(expected).toString("hex"))) return null;
    return { description: mapping.english_template ?? mapping.template ?? `Matched ${expected ?? "event"}`, eventType: expected ?? "Event" };
  };
}

export function registerUpgrade(contractId: string, version: string, fromLedger: number, eventMappings: any[]): void {
  const entry = REGISTRY.get(contractId);
  if (!entry) return;
  const blueprint: TranslationBlueprint = {
    schemaVersion: BLUEPRINT_SCHEMA_VERSION,
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
  entry.schemas.push(normalizeBlueprint(blueprint, version, fromLedger));
  sortAndCloseSchemas(entry);
  for (const key of Array.from(RESOLUTION_CACHE.keys())) if (key.startsWith(`${contractId}:`)) RESOLUTION_CACHE.delete(key);
}

function resolveSchema(contractId: string, ledger: number, customBlueprints?: Map<string, TranslationBlueprint>): ContractSchema | null {
  const custom = customBlueprints?.get(contractId);
  if (custom) return normalizeBlueprint(custom, "custom", 0);
  const cacheKey = `${contractId}:${ledger}`;
  const cached = RESOLUTION_CACHE.get(cacheKey);
  if (cached) return cached;
  const entry = REGISTRY.get(contractId);
  if (!entry) return null;
  const schema = entry.schemas.find((s) => ledger >= s.validFromLedger && (s.validToLedger === null || ledger <= s.validToLedger));
  if (schema) RESOLUTION_CACHE.set(cacheKey, schema);
  return schema ?? null;
}

export function translateEvent(event: RawEvent, customBlueprints?: Map<string, TranslationBlueprint>, lang: Language = "en"): TranslatedEvent {
  const schema = resolveSchema(event.contractId, event.ledger, customBlueprints);
  if (!schema) {
    console.warn(`No translation blueprint found for contract ${event.contractId}`);
    const genericDecoded = decodeGenericEventPayload(event);
    const description = genericDecoded ? `[Unregistered Contract] ${formatGenericValue(genericDecoded)}` : `[Unknown Event: No blueprint registered for contract ${event.contractId}. Hex Data: ${event.data}]`;
    return { raw: event, description: sanitizeTextField(description, { maxLength: 512 }), status: "cryptic", blueprintName: "Unregistered Contract", eventType: null, schemaVersion: null };
  }
  const translated = applyBlueprint(event, schema.blueprint, lang, schema.version);
  if (translated) return translated;
  return { raw: event, description: null, status: "cryptic", blueprintName: schema.blueprint.contractName, eventType: null, schemaVersion: schema.version };
}

function applyBlueprint(event: RawEvent, blueprint: TranslationBlueprint, lang: Language, schemaVersion: string): TranslatedEvent | null {
  assertBlueprintSchemaVersion(blueprint);
  if (blueprint.matches && !blueprint.matches(event)) return null;
  const result = blueprint.translate(event, lang);
  if (!result) return null;
  return { raw: event, description: result.description ? sanitizeTextField(result.description) : null, status: "translated", blueprintName: blueprint.contractName, eventType: result.eventType ? sanitizeTextField(result.eventType, { maxLength: 64 }) : null, schemaVersion };
}

export function matchesEventCriteria(event: RawEvent, criteria: EventMatchCriteria): boolean {
  if (criteria.contractId && event.contractId !== criteria.contractId) return false;
  for (const topicCriteria of criteria.topics ?? []) {
    const topic = event.topics[topicCriteria.index];
    if (typeof topic !== "string") return false;
    if (topicCriteria.equals && topic !== topicCriteria.equals) return false;
    if (topicCriteria.includes && !topic.toLowerCase().includes(topicCriteria.includes.toLowerCase())) return false;
    if (topicCriteria.decodedName && decodeEventName(topic) !== topicCriteria.decodedName) return false;
  }
  return true;
}

export function translateEvents(events: RawEvent[], customBlueprints?: Map<string, TranslationBlueprint>, lang: Language = "en"): TranslatedEvent[] {
  return events.map((event) => translateEventSafe(event, customBlueprints, lang));
}

function translateEventSafe(event: RawEvent, customBlueprints: Map<string, TranslationBlueprint> | undefined, lang: Language): TranslatedEvent {
  try {
    return translateEvent(event, customBlueprints, lang);
  } catch (error) {
    const templateError = new RegistryTemplateException(error instanceof Error ? error.message : "Translation failed", { contractId: event.contractId, ledgerSequence: event.ledger, xdrHex: event.data, txHash: event.txHash, operation: "translateEvent" }, error);
    captureExceptionSync(templateError);
    return { raw: event, description: null, status: "cryptic", blueprintName: null, eventType: null, schemaVersion: null };
  }
}

export function hasBlueprint(contractId: string): boolean { return REGISTRY.has(contractId); }
export function getRegisteredContracts(): string[] { return Array.from(REGISTRY.keys()); }
export function getBlueprintCount(): number { return REGISTRY.size; }

export function registerBlueprint(...blueprints: TranslationBlueprint[]): void {
  for (const blueprint of blueprints) addSchema(REGISTRY, blueprint, (blueprint as VersionedTranslationBlueprint).version ?? "1.0.0", (blueprint as VersionedTranslationBlueprint).validFromLedger ?? 0);
}
