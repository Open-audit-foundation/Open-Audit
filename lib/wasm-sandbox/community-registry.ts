/**
 * File-based community parser registration + Translation Registry bridge (#405).
 *
 * Community parsers are registered alongside native blueprints but clearly
 * marked parserProvenance: "community-wasm". Sync translateEvent() cannot
 * run WASM (worker isolation is async); use translateEventAsync() /
 * translateWithCache() which already await.
 */

import { readFile } from "fs/promises";
import path from "path";
import type {
  CommunityWasmBlueprint,
  Language,
  RawEvent,
  TranslationBlueprint,
  VersionedTranslationBlueprint,
  TranslationResult,
  TranslatedEvent,
} from "../translator/types";
import { registerBlueprint, unregisterBlueprint } from "../translator/registry";
import { sanitizeTextField } from "../translator/core";
import { WasmSandboxRunner } from "./runner";
import type {
  CommunityParserManifest,
  WasmParserInput,
} from "./types";
import { WasmExecutionError } from "./types";

export interface RegisteredCommunityParser {
  manifest: CommunityParserManifest;
  wasmBytes: Uint8Array;
  blueprint: CommunityWasmBlueprint;
}

const COMMUNITY = new Map<string, RegisteredCommunityParser>();
const defaultRunner = new WasmSandboxRunner();

export function getCommunityParser(contractId: string): RegisteredCommunityParser | undefined {
  return COMMUNITY.get(contractId);
}

export function listCommunityParsers(): RegisteredCommunityParser[] {
  return Array.from(COMMUNITY.values());
}

export function clearCommunityParsers(): void {
  for (const contractId of COMMUNITY.keys()) {
    unregisterBlueprint(contractId);
  }
  COMMUNITY.clear();
}

export function isCommunityWasmBlueprint(
  blueprint: TranslationBlueprint | null | undefined
): blueprint is TranslationBlueprint & {
  parserProvenance: "community-wasm";
  wasmBytes: Uint8Array;
} {
  return (
    !!blueprint &&
    (blueprint as { parserProvenance?: string }).parserProvenance === "community-wasm" &&
    (blueprint as { wasmBytes?: Uint8Array }).wasmBytes instanceof Uint8Array
  );
}

/**
 * Register a community parser from in-memory WASM bytes + manifest.
 * Also installs a TranslationBlueprint into the global registry.
 */
export function registerCommunityParserFromBytes(
  manifest: CommunityParserManifest,
  wasmBytes: Uint8Array,
  runner: WasmSandboxRunner = defaultRunner
): RegisteredCommunityParser {
  const blueprint: CommunityWasmBlueprint = {
    contractId: manifest.contractId,
    contractName: manifest.contractName,
    ...(manifest.version === undefined ? {} : { version: manifest.version }),
    parserProvenance: "community-wasm",
    wasmBytes,
    // Sync path cannot run the worker sandbox; return null so callers use async.
    translate: (_event: RawEvent, _lang: Language): TranslationResult | null => null,
    translateAsync(event: RawEvent): Promise<TranslatedEvent> {
      return translateWithCommunityParser(event, blueprint);
    },
  };

  // Attach a non-enumerable runner ref for async translation.
  Object.defineProperty(blueprint, "__wasmRunner", {
    value: runner,
    enumerable: false,
    writable: false,
  });

  const entry: RegisteredCommunityParser = { manifest, wasmBytes, blueprint };
  COMMUNITY.set(manifest.contractId, entry);
  registerBlueprint(blueprint);
  return entry;
}

/**
 * Load a manifest JSON + adjacent .wasm from disk and register it.
 */
export async function registerCommunityParserFromManifest(
  manifestPath: string,
  runner: WasmSandboxRunner = defaultRunner
): Promise<RegisteredCommunityParser> {
  const raw = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(raw) as CommunityParserManifest;
  const wasmPath = path.isAbsolute(manifest.wasmPath)
    ? manifest.wasmPath
    : path.resolve(path.dirname(manifestPath), manifest.wasmPath);
  const wasmBytes = new Uint8Array(await readFile(wasmPath));
  return registerCommunityParserFromBytes(manifest, wasmBytes, runner);
}

function toWasmInput(event: RawEvent): WasmParserInput {
  return {
    id: event.id,
    contractId: event.contractId,
    topics: event.topics,
    data: event.data,
    ledger: event.ledger,
    timestamp: event.timestamp,
    txHash: event.txHash,
  };
}

/**
 * Run a community-wasm blueprint under the sandbox and map to TranslatedEvent.
 */
export async function translateWithCommunityParser(
  event: RawEvent,
  blueprint: VersionedTranslationBlueprint & { wasmBytes: Uint8Array },
  runner?: WasmSandboxRunner
): Promise<TranslatedEvent> {
  const activeRunner =
    runner ??
    ((blueprint as { __wasmRunner?: WasmSandboxRunner }).__wasmRunner as
      | WasmSandboxRunner
      | undefined) ??
    defaultRunner;

  const result = await activeRunner.execute(blueprint.wasmBytes, toWasmInput(event));

  if (!result.success) {
    return {
      raw: event,
      description: null,
      status: "cryptic",
      blueprintName: blueprint.contractName,
      eventType: null,
      schemaVersion: blueprint.version ?? null,
      parserProvenance: "community-wasm",
      sandboxError: result.error.errorType,
    };
  }

  return {
    raw: event,
    description: sanitizeTextField(result.output.description),
    status: "translated",
    blueprintName: blueprint.contractName,
    eventType: sanitizeTextField(result.output.eventType, { maxLength: 64 }),
    schemaVersion: blueprint.version ?? null,
    parserProvenance: "community-wasm",
  };
}

export { WasmExecutionError };
