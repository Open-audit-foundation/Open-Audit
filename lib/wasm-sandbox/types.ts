/**
 * Types for the community-parser WASM sandbox (#405).
 */

/** JSON payload the host writes into guest linear memory. */
export interface WasmParserInput {
  id: string;
  contractId: string;
  topics: string[];
  data: string;
  ledger: number;
  timestamp: number;
  txHash: string;
}

/** JSON payload the guest must write back (TranslationResult shape). */
export interface WasmParserOutput {
  description: string;
  eventType: string;
}

export interface ExecutionStats {
  executionTimeMs: number;
  peakMemoryBytes: number;
  timedOut: boolean;
}

export type WasmErrorType =
  | "LOAD_FAILED"
  | "INSTANTIATION_FAILED"
  | "INVALID_EXPORTS"
  | "FORBIDDEN_IMPORTS"
  | "MEMORY_LIMIT_EXCEEDED"
  | "TIMEOUT_EXCEEDED"
  | "RUNTIME_TRAP"
  | "INVALID_INPUT"
  | "INVALID_OUTPUT"
  | "ALLOCATION_FAILED"
  | "UNKNOWN_ERROR";

export class WasmExecutionError extends Error {
  constructor(
    message: string,
    public readonly errorType: WasmErrorType,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "WasmExecutionError";
  }
}

export type WasmExecutionResult =
  | { success: true; output: WasmParserOutput; error: null; stats: ExecutionStats }
  | {
      success: false;
      output: null;
      error: WasmExecutionError;
      stats: ExecutionStats;
    };

/** Limits enforced by the host (never by the guest). */
export interface SandboxLimits {
  /** Max WASM memory pages (64 KiB each). Default 256 (= 16 MiB). */
  maxMemoryPages: number;
  /** Wall-clock execution budget. Default 1000 ms. */
  maxExecutionTimeMs: number;
  /** Max UTF-8 bytes of the JSON input. Default 256 KiB. */
  maxInputBytes: number;
  /** Max UTF-8 bytes of the JSON output. Default 64 KiB. */
  maxOutputBytes: number;
}

export const DEFAULT_SANDBOX_LIMITS: SandboxLimits = {
  maxMemoryPages: 256,
  maxExecutionTimeMs: 1000,
  maxInputBytes: 256 * 1024,
  maxOutputBytes: 64 * 1024,
};

/**
 * File-based community parser manifest (submitted via PR).
 * See COMMUNITY_PARSER_GUIDE.md.
 */
export interface CommunityParserManifest {
  /** Unique id for this parser contribution. */
  id: string;
  /** Soroban contract address this parser handles. */
  contractId: string;
  /** Human-readable contract / parser name. */
  contractName: string;
  /** Path to the .wasm module, relative to the manifest or absolute. */
  wasmPath: string;
  /** Semver label shown in schemaVersion. */
  version?: string;
  /** Author attribution (display only). */
  author?: string;
  /** Short description. */
  description?: string;
}

/** Provenance marker surfaced on TranslatedEvent. */
export type ParserProvenance = "native" | "community-wasm";
