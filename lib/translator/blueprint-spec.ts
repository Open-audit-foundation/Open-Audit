/**
 * blueprint-spec.ts
 *
 * Shared spec type and parser consumed by BOTH the CLI (open-audit-cli --spec)
 * and the production registry (lib/translator/registry.ts).
 *
 * Previously, the CLI maintained a parallel BlueprintSpec interface and a local
 * buildBlueprint() converter. This created a silent drift risk: a spec that
 * passed CLI validation could behave differently once registered for real.
 *
 * This module is the single source of truth. Any change to how blueprints are
 * parsed or validated must happen here so both code paths stay equivalent.
 */

import type {
  RawEvent,
  TranslationBlueprint,
  TranslationResult,
  Language,
} from "./types";

// ============================================================================
// Shared Spec Types
// ============================================================================

/**
 * The on-disk format for a blueprint spec file (.json or .yaml).
 * This is the type that open-audit-cli --spec consumes AND the type that
 * registry.ts uses when loading file-based blueprints.
 */
export interface BlueprintSpec {
  /** The Soroban contract address this spec targets. */
  contractId: string;
  /** Human-readable name for the contract. */
  contractName: string;
  /**
   * Optional semver label, e.g. "1.2.3".
   * Maps to VersionedTranslationBlueprint.version in the registry.
   */
  version?: string;
  /**
   * First ledger this schema is valid from.
   * Maps to VersionedTranslationBlueprint.validFromLedger.
   * Defaults to 0 (applies from genesis).
   */
  validFromLedger?: number;
  /** At least one event definition is required. */
  events: EventSpec[];
}

/** A single event pattern within a BlueprintSpec. */
export interface EventSpec {
  /** Short name for the event type, e.g. "Transfer". */
  name: string;
  /**
   * Template string for the human-readable description.
   * Use {fieldName} placeholders that match entries in `fields`.
   * e.g. "{from} sent {amount} {symbol} to {to}"
   */
  template: string;
  /** Optional topic matchers — all must pass for this event to match. */
  topics?: TopicMatcher[];
  /** Field extraction rules — defines how to pull values from the raw event. */
  fields: FieldMapping[];
}

/** A condition that must hold for a specific topic index. */
export interface TopicMatcher {
  /** Zero-based index into event.topics[]. */
  index: number;
  /** Exact hex/string match. */
  equals?: string;
  /** Case-insensitive substring match. */
  includes?: string;
  /** Expected event name after XDR Symbol decoding. */
  decodedName?: string;
}

/** Describes how to extract and format a single value from a raw event. */
export interface FieldMapping {
  /** Name used in the template placeholder, e.g. "from". */
  name: string;
  /** Where to read the value from. */
  source: "topic" | "data";
  /** Topic index when source is "topic". */
  index?: number;
  /**
   * Value type — controls how the raw hex is formatted.
   * Supported: "address" | "amount" | "u128" | "i128" | "string" | "symbol" | "hex" | "bytes"
   */
  type: string;
  /** Optional format hint, e.g. asset symbol "XLM" for amount types. */
  format?: string;
}

// ============================================================================
// Validation
// ============================================================================

export class BlueprintSpecValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlueprintSpecValidationError";
  }
}

/**
 * Validates a parsed BlueprintSpec object.
 * Throws BlueprintSpecValidationError if any required field is missing or malformed.
 *
 * This is the shared validation logic used by both the CLI and the registry.
 * Running this function guarantees the spec will behave identically in both
 * environments.
 */
export function validateBlueprintSpec(spec: unknown): BlueprintSpec {
  if (!spec || typeof spec !== "object") {
    throw new BlueprintSpecValidationError("Spec must be a non-null object");
  }

  const s = spec as Record<string, unknown>;

  if (!s.contractName || typeof s.contractName !== "string") {
    throw new BlueprintSpecValidationError(
      "Missing required field: contractName (string)"
    );
  }

  if (!s.contractId || typeof s.contractId !== "string") {
    throw new BlueprintSpecValidationError(
      "Missing required field: contractId (string)"
    );
  }

  if (!s.contractId.startsWith("C")) {
    throw new BlueprintSpecValidationError(
      `Invalid contractId: must start with 'C' (Stellar contract address), got "${s.contractId}"`
    );
  }

  if (!Array.isArray(s.events) || s.events.length === 0) {
    throw new BlueprintSpecValidationError(
      "Missing required field: events (non-empty array)"
    );
  }

  for (let i = 0; i < s.events.length; i++) {
    validateEventSpec(s.events[i], i);
  }

  if (s.version !== undefined && typeof s.version !== "string") {
    throw new BlueprintSpecValidationError("Field version must be a string");
  }

  if (s.validFromLedger !== undefined && typeof s.validFromLedger !== "number") {
    throw new BlueprintSpecValidationError(
      "Field validFromLedger must be a number"
    );
  }

  return s as unknown as BlueprintSpec;
}

function validateEventSpec(event: unknown, index: number): void {
  if (!event || typeof event !== "object") {
    throw new BlueprintSpecValidationError(
      `events[${index}] must be a non-null object`
    );
  }

  const e = event as Record<string, unknown>;
  const prefix = `events[${index}]`;

  if (!e.name || typeof e.name !== "string") {
    throw new BlueprintSpecValidationError(
      `${prefix} missing required field: name (string)`
    );
  }

  if (!e.template || typeof e.template !== "string") {
    throw new BlueprintSpecValidationError(
      `${prefix} missing required field: template (string)`
    );
  }

  if (!Array.isArray(e.fields) || e.fields.length === 0) {
    throw new BlueprintSpecValidationError(
      `${prefix} missing required field: fields (non-empty array)`
    );
  }

  for (let i = 0; i < e.fields.length; i++) {
    validateFieldMapping(e.fields[i], `${prefix}.fields[${i}]`);
  }
}

function validateFieldMapping(field: unknown, path: string): void {
  if (!field || typeof field !== "object") {
    throw new BlueprintSpecValidationError(`${path} must be a non-null object`);
  }

  const f = field as Record<string, unknown>;

  if (!f.name || typeof f.name !== "string") {
    throw new BlueprintSpecValidationError(
      `${path} missing required field: name (string)`
    );
  }

  if (f.source !== "topic" && f.source !== "data") {
    throw new BlueprintSpecValidationError(
      `${path} field source must be "topic" or "data", got "${f.source}"`
    );
  }

  if (!f.type || typeof f.type !== "string") {
    throw new BlueprintSpecValidationError(
      `${path} missing required field: type (string)`
    );
  }

  const validTypes = ["address", "amount", "u128", "i128", "string", "symbol", "hex", "bytes"];
  if (!validTypes.includes((f.type as string).toLowerCase())) {
    throw new BlueprintSpecValidationError(
      `${path} unsupported type "${f.type}". Must be one of: ${validTypes.join(", ")}`
    );
  }
}

// ============================================================================
// Shared Blueprint Builder
// ============================================================================

/**
 * Builds a TranslationBlueprint from a validated BlueprintSpec.
 *
 * This is the SAME function used by both the CLI and the registry loader.
 * Using a shared builder guarantees that a spec which passes CLI testing
 * will produce identical translation behaviour in production.
 */
export function buildBlueprintFromSpec(spec: BlueprintSpec): TranslationBlueprint {
  return {
    contractId: spec.contractId,
    contractName: spec.contractName,
    matches: spec.events.some((e) => e.topics && e.topics.length > 0)
      ? (event: RawEvent) => matchesAnyEvent(event, spec.events)
      : undefined,
    translate: (event: RawEvent, lang: Language): TranslationResult | null => {
      for (const eventSpec of spec.events) {
        if (matchesEvent(event, eventSpec)) {
          return {
            description: translateEvent(event, eventSpec),
            eventType: eventSpec.name,
          };
        }
      }
      return null;
    },
  };
}

// ============================================================================
// Internal matching and translation helpers
// ============================================================================

function matchesAnyEvent(event: RawEvent, events: EventSpec[]): boolean {
  return events.some((e) => matchesEvent(event, e));
}

function matchesEvent(event: RawEvent, eventSpec: EventSpec): boolean {
  if (!eventSpec.topics || eventSpec.topics.length === 0) return true;

  for (const matcher of eventSpec.topics) {
    const topic = event.topics[matcher.index];
    if (!topic) return false;

    if (matcher.equals && topic !== matcher.equals) return false;

    if (
      matcher.includes &&
      !topic.toLowerCase().includes(matcher.includes.toLowerCase())
    ) {
      return false;
    }

    if (matcher.decodedName) {
      const decoded = decodeTopicSymbol(topic);
      if (decoded !== matcher.decodedName) return false;
    }
  }

  return true;
}

function translateEvent(event: RawEvent, eventSpec: EventSpec): string {
  const params: Record<string, string> = {};

  for (const field of eventSpec.fields) {
    const raw =
      field.source === "topic" && field.index !== undefined
        ? event.topics[field.index] ?? ""
        : event.data;

    params[field.name] = formatFieldValue(raw, field.type, field.format);
  }

  return interpolate(eventSpec.template, params);
}

function formatFieldValue(hex: string, type: string, format?: string): string {
  if (!hex) return "unknown";

  switch (type.toLowerCase()) {
    case "address":
      return shortenAddress(decodeHexAddress(hex));
    case "amount":
    case "u128":
    case "i128":
      return formatHexAmount(hex, format ?? "TOKEN");
    case "string":
    case "symbol":
      return decodeHexString(hex);
    case "hex":
    case "bytes":
      return truncateHex(hex);
    default:
      return hex;
  }
}

function interpolate(template: string, params: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    params[key] !== undefined ? params[key] : match
  );
}

function shortenAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function decodeHexAddress(hex: string): string {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const seed = clean.slice(0, 8).toUpperCase();
  const tail = clean.slice(-4).toUpperCase();
  return `G${seed}${"A".repeat(48 - seed.length)}${tail}`;
}

function formatHexAmount(hex: string, symbol: string): string {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const value = BigInt(`0x${clean.slice(0, 16) || "0"}`);
  return `${(Number(value) / 10_000_000).toFixed(2)} ${symbol}`;
}

function decodeHexString(hex: string): string {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  try {
    return Buffer.from(clean, "hex").toString("utf8").replace(/\0/g, "");
  } catch {
    return truncateHex(hex);
  }
}

function truncateHex(hex: string, chars = 8): string {
  if (hex.length <= chars * 2 + 2) return hex;
  return `${hex.slice(0, chars + 2)}...${hex.slice(-chars)}`;
}

function decodeTopicSymbol(topicHex: string): string {
  const known: Record<string, string> = {
    "0x0000000000000000000000000000000000000000000000000000000074726e73": "transfer",
    "0x000000000000000000000000000000000000000000000000000000006d696e74": "mint",
    "0x000000000000000000000000000000000000000000000000000000006275726e": "burn",
  };
  return known[topicHex] ?? "unknown";
}
