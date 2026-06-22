/**
 * Custom ABI support for Open-Audit.
 *
 * The global Translation Registry (./registry.ts) only knows about contracts
 * the community has merged blueprints for. Developers building new dApps on
 * testnet need to translate their *own* contracts before submitting them.
 *
 * This module lets the dashboard:
 *   1. Parse a Soroban ABI JSON file (as produced by `soroban contract bindings`)
 *      into a {@link CustomAbi}.
 *   2. Persist uploaded ABIs in the browser's localStorage.
 *   3. Turn each ABI into a {@link TranslationBlueprint} that the registry
 *      consults BEFORE the global registry.
 *
 * Decoding reuses the same helpers as the built-in blueprints (./decode.ts),
 * so custom translations render in the same style as registry translations.
 */

import { decodeAddress, decodeAmount, decodeEventName, truncateHex } from "./decode";
import { sanitizeTextField, sanitizeTemplateParam } from "./core";
import { RegistryTemplateException } from "../errors";
import type {
  CustomAbi,
  CustomAbiEvent,
  CustomAbiField,
  RawEvent,
  TranslationBlueprint,
  TranslationResult,
  Language,
} from "./types";

/** localStorage key under which uploaded ABIs are stored. */
export const CUSTOM_ABI_STORAGE_KEY = "open-audit:custom-abis";

/** Field types rendered as a shortened Stellar address. */
const ADDRESS_TYPES = new Set(["address", "account", "contract"]);

/** Field types rendered as a decimal token amount. */
const AMOUNT_TYPES = new Set(["amount", "i128", "u128", "i64", "u64", "i32", "u32"]);

// ── Parsing ──────────────────────────────────────────────────────────────────

/**
 * Parses an arbitrary JSON value into a {@link CustomAbi}.
 *
 * Accepts a few shapes so the same upload box works for hand-written ABIs and
 * `soroban contract bindings` output:
 *   - An object with an `events` array (the native Open-Audit shape).
 *   - A contract-spec array of entries (event-typed entries are extracted).
 *   - An object with an `entries` array.
 *
 * The Contract ID may live in the file (`contractId` / `contractAddress` /
 * `address`) or be supplied separately via {@link fallbackContractId}.
 *
 * @throws Error with a user-friendly message when the input cannot be parsed.
 */
export function parseCustomAbi(input: unknown, fallbackContractId?: string): CustomAbi {
  const root = isRecord(input) ? input : {};

  const contractId =
    asString(root.contractId) ??
    asString(root.contractAddress) ??
    asString(root.address) ??
    (fallbackContractId ? fallbackContractId.trim() : null);

  if (!contractId) {
    throw new RegistryTemplateException(
      "A Contract ID is required to associate this ABI with a contract.",
      { operation: "parseCustomAbi" }
    );
  }

  const eventRecords = collectEventRecords(input);
  if (eventRecords.length === 0) {
    throw new RegistryTemplateException(
      "No event definitions were found. Expected an `events` array or a contract spec with event entries.",
      { contractId, operation: "parseCustomAbi" }
    );
  }

  const events: CustomAbiEvent[] = eventRecords.map(function (record): CustomAbiEvent {
    return {
      name: asString(record.name) ?? "event",
      fields: parseFields(record),
    };
  });

  const contractName =
    asString(root.contractName) ??
    asString(root.name) ??
    `Custom Contract (${contractId.slice(0, 6)}...)`;

  return { contractId, contractName, events };
}

/** Collects event-like records from any of the supported input shapes. */
function collectEventRecords(input: unknown): Record<string, unknown>[] {
  if (Array.isArray(input)) {
    return input.filter(isEventLike);
  }
  if (isRecord(input)) {
    if (Array.isArray(input.events)) return input.events.filter(isEventLike);
    if (Array.isArray(input.entries)) return input.entries.filter(isEventLike);
  }
  return [];
}

/**
 * A value is "event-like" if it is a named record that is not explicitly
 * tagged as a non-event spec entry (function, struct, enum, ...).
 */
function isEventLike(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  if (asString(value.name) === null) return false;
  const kind = asString(value.type);
  return kind === null || kind === "event";
}

/** Extracts ordered field definitions from an event record. */
function parseFields(eventRecord: Record<string, unknown>): CustomAbiField[] {
  const rawFields = firstArray(
    eventRecord.fields,
    eventRecord.params,
    eventRecord.inputs,
    eventRecord.topics
  );

  const fields: CustomAbiField[] = [];
  for (const entry of rawFields) {
    if (!isRecord(entry)) continue;
    const name = asString(entry.name) ?? `field${fields.length + 1}`;
    // Spec entries nest the type; we only use it for display, so fall back to
    // "bytes" (raw hex) whenever the type isn't a plain string.
    const type = asString(entry.type) ?? asString(entry.value) ?? "bytes";
    fields.push({ name, type });
  }
  return fields;
}

// ── Translation ──────────────────────────────────────────────────────────────

/** Converts a parsed ABI into a TranslationBlueprint for one contract. */
export function customAbiToBlueprint(abi: CustomAbi): TranslationBlueprint {
  return {
    contractId: abi.contractId,
    contractName: `${abi.contractName} (Custom ABI)`,
    translate: function (event: RawEvent, lang: Language): TranslationResult | null {
      return translateWithAbi(abi, event, lang);
    },
  };
}

/** Builds a contractId → blueprint map for a list of custom ABIs. */
export function buildCustomBlueprints(abis: CustomAbi[]): Map<string, TranslationBlueprint> {
  const map = new Map<string, TranslationBlueprint>();
  for (const abi of abis) {
    map.set(abi.contractId, customAbiToBlueprint(abi));
  }
  return map;
}

/** Attempts to translate an event using a custom ABI. */
function translateWithAbi(abi: CustomAbi, event: RawEvent, lang: Language): TranslationResult | null {
  const topic0 = event.topics[0] ?? "";
  const decodedName = decodeEventName(topic0);

  const matched = abi.events.find(function (eventDef: CustomAbiEvent): boolean {
    return matchesEvent(topic0, decodedName, eventDef.name);
  });

  if (!matched) return null;

  return {
    description: renderEvent(matched, event),
    eventType: capitalize(matched.name),
  };
}

/**
 * Matches an event by name, either via the known-topic decoder or by checking
 * whether the topic hex contains the ASCII encoding of the event name (the same
 * approach the built-in SAC blueprints use).
 */
function matchesEvent(topicHex: string, decodedName: string, eventName: string): boolean {
  if (decodedName !== "unknown" && decodedName === eventName) return true;
  const fragment = asciiToHex(eventName);
  return fragment.length > 0 && topicHex.toLowerCase().includes(fragment);
}

/** Renders a matched event into a human-readable sentence. */
function renderEvent(eventDef: CustomAbiEvent, event: RawEvent): string {
  // Sanitize the event label — it comes from user-uploaded ABI name field
  const label = sanitizeTextField(capitalize(eventDef.name), { maxLength: 64 });

  if (eventDef.fields.length === 0) {
    return `${label} event emitted (${truncateHex(event.data, 8)})`;
  }

  // Fields map positionally to topics[1..] followed by the data value.
  const positions = [...event.topics.slice(1), event.data];

  const parts = eventDef.fields.map(function (field: CustomAbiField, index: number): string {
    const hex = positions[index] ?? "0x00";
    // Sanitize field name from ABI and the rendered value from blockchain data
    const safeName = sanitizeTextField(field.name, { maxLength: 64 });
    return `${safeName}: ${renderField(field, hex)}`;
  });

  return `${label} — ${parts.join(", ")}`;
}

/** Renders a single field value based on its declared type. */
function renderField(field: CustomAbiField, hex: string): string {
  const type = field.type.toLowerCase();
  if (ADDRESS_TYPES.has(type)) {
    // Address values are hex-only — safe to render without HTML escaping
    return `[${decodeAddress(hex).short}]`;
  }
  if (AMOUNT_TYPES.has(type)) {
    // Numeric formatted values are safe
    return decodeAmount(hex).formatted;
  }
  // Raw hex truncated — sanitize in case a future decoder emits human-readable text
  return sanitizeTemplateParam(truncateHex(hex, 6));
}

// ── Persistence (localStorage) ───────────────────────────────────────────────

/** Loads all stored custom ABIs. Returns [] on the server or on any error. */
export function loadCustomAbis(): CustomAbi[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = window.localStorage.getItem(CUSTOM_ABI_STORAGE_KEY);
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.filter(isValidStoredAbi) : [];
  } catch {
    return [];
  }
}

/** Upserts an ABI (keyed by contractId) and returns the updated list. */
export function saveCustomAbi(abi: CustomAbi): CustomAbi[] {
  const others = loadCustomAbis().filter(function (existing: CustomAbi): boolean {
    return existing.contractId !== abi.contractId;
  });
  const next = [...others, abi];
  persist(next);
  return next;
}

/** Removes the ABI for a contractId and returns the updated list. */
export function removeCustomAbi(contractId: string): CustomAbi[] {
  const next = loadCustomAbis().filter(function (existing: CustomAbi): boolean {
    return existing.contractId !== contractId;
  });
  persist(next);
  return next;
}

/** Writes the list to localStorage, swallowing quota/availability errors. */
function persist(abis: CustomAbi[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CUSTOM_ABI_STORAGE_KEY, JSON.stringify(abis));
  } catch {
    // Storage may be unavailable (private mode, quota) — degrade gracefully.
  }
}

/** Validates the shape of an ABI read back from storage. */
function isValidStoredAbi(value: unknown): value is CustomAbi {
  return (
    isRecord(value) &&
    typeof value.contractId === "string" &&
    typeof value.contractName === "string" &&
    Array.isArray(value.events)
  );
}

// ── Small utilities ──────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Returns the first argument that is an array, or an empty array. */
function firstArray(...candidates: unknown[]): unknown[] {
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function asciiToHex(text: string): string {
  let hex = "";
  for (let i = 0; i < text.length; i++) {
    hex += text.charCodeAt(i).toString(16).padStart(2, "0");
  }
  return hex;
}

function capitalize(text: string): string {
  if (text.length === 0) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}
