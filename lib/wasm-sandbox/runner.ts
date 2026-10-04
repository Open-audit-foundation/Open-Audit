/**
 * WasmSandboxRunner — host-side API for untrusted community parsers (#405).
 *
 * Isolation model:
 * - Guest runs in a dedicated worker_threads Worker that can be force-terminated.
 * - Guest may import ONLY env.memory, created by the host with a hard maximum.
 * - No WASI, filesystem, network, or Node API imports are permitted.
 * - Wall-clock CPU budget enforced by terminating the worker.
 * - Input/output size caps enforced on the host before/after execution.
 */

import { Worker } from "worker_threads";
import { readFile, stat } from "fs/promises";
import path from "path";
import {
  DEFAULT_SANDBOX_LIMITS,
  type SandboxLimits,
  type WasmExecutionResult,
  type WasmParserInput,
  type WasmParserOutput,
  WasmExecutionError,
  type WasmErrorType,
} from "./types";

const MAX_WASM_MODULE_BYTES = 8 * 1024 * 1024;

function resolveWorkerPath(): string {
  // Stable path from repo root (vitest / tsx / node all cwd = project root).
  return path.join(process.cwd(), "lib/wasm-sandbox/worker.cjs");
}

export class WasmSandboxRunner {
  private readonly limits: SandboxLimits;

  constructor(limits: Partial<SandboxLimits> = {}) {
    this.limits = { ...DEFAULT_SANDBOX_LIMITS, ...limits };
  }

  getLimits(): SandboxLimits {
    return { ...this.limits };
  }

  /** Kept for callers; modules are compiled only inside their killable worker. */
  clearCache(): void {
    // No cached modules remain; each worker compiles the bytes it executes.
  }

  /**
   * Execute a community parser WASM module.
   * @param wasm Source: filesystem path, or raw bytes.
   * @param input Event payload (will be JSON-serialized into guest memory).
   */
  async execute(
    wasm: string | Uint8Array | Buffer,
    input: WasmParserInput
  ): Promise<WasmExecutionResult> {
    const started = Date.now();
    let peakMemoryBytes = 0;
    let timedOut = false;

    try {
      const inputJson = this.validateInput(input);
      const bytes = await this.loadBytes(wasm);

      const workerResult = await this.runInWorker(
        bytes,
        inputJson,
        this.limits.maxExecutionTimeMs
      );
      peakMemoryBytes = workerResult.peakMemoryBytes;
      timedOut = workerResult.timedOut;

      if (timedOut) {
        throw new WasmExecutionError(
          `Execution exceeded timeout of ${this.limits.maxExecutionTimeMs}ms`,
          "TIMEOUT_EXCEEDED"
        );
      }
      if (!workerResult.success) {
        throw new WasmExecutionError(
          workerResult.errorMessage,
          workerResult.errorType ?? "RUNTIME_TRAP"
        );
      }

      const output = this.validateOutput(workerResult.output!);
      return {
        success: true,
        output,
        error: null,
        stats: {
          executionTimeMs: Date.now() - started,
          peakMemoryBytes,
          timedOut: false,
        },
      };
    } catch (error) {
      const wasmError =
        error instanceof WasmExecutionError
          ? error
          : new WasmExecutionError(
              error instanceof Error ? error.message : String(error),
              "UNKNOWN_ERROR",
              error
            );
      return {
        success: false,
        output: null,
        error: wasmError,
        stats: {
          executionTimeMs: Date.now() - started,
          peakMemoryBytes,
          timedOut,
        },
      };
    }
  }

  private async loadBytes(wasm: string | Uint8Array | Buffer): Promise<Uint8Array> {
    let bytes: Uint8Array;
    if (typeof wasm === "string") {
      try {
        const file = await stat(wasm);
        if (file.size > MAX_WASM_MODULE_BYTES) {
          throw new WasmExecutionError(
            `WASM module exceeds ${MAX_WASM_MODULE_BYTES} bytes`,
            "LOAD_FAILED"
          );
        }
        bytes = new Uint8Array(await readFile(wasm));
      } catch (error) {
        if (error instanceof WasmExecutionError) throw error;
        throw new WasmExecutionError(
          `Failed to load WASM from ${wasm}: ${
            error instanceof Error ? error.message : String(error)
          }`,
          "LOAD_FAILED",
          error
        );
      }
    } else {
      bytes = wasm instanceof Buffer ? new Uint8Array(wasm) : wasm;
    }
    if (bytes.byteLength > MAX_WASM_MODULE_BYTES) {
      throw new WasmExecutionError(
        `WASM module exceeds ${MAX_WASM_MODULE_BYTES} bytes`,
        "LOAD_FAILED"
      );
    }
    return bytes;
  }

  private validateInput(input: WasmParserInput): string {
    if (!input || typeof input !== "object") {
      throw new WasmExecutionError("Input must be an object", "INVALID_INPUT");
    }
    if (!input.contractId || typeof input.contractId !== "string") {
      throw new WasmExecutionError("contractId is required", "INVALID_INPUT");
    }
    if (!Array.isArray(input.topics)) {
      throw new WasmExecutionError("topics must be an array", "INVALID_INPUT");
    }
    if (typeof input.data !== "string") {
      throw new WasmExecutionError("data must be a string", "INVALID_INPUT");
    }
    // Snapshot before any await: the worker must execute the same bytes we cap.
    const inputJson = JSON.stringify(input);
    const size = Buffer.byteLength(inputJson, "utf8");
    if (size > this.limits.maxInputBytes) {
      throw new WasmExecutionError(
        `Input size (${size}) exceeds max (${this.limits.maxInputBytes})`,
        "INVALID_INPUT"
      );
    }
    return inputJson;
  }

  private validateOutput(raw: unknown): WasmParserOutput {
    if (!raw || typeof raw !== "object") {
      throw new WasmExecutionError("Output must be an object", "INVALID_OUTPUT");
    }
    const obj = raw as Record<string, unknown>;
    if (typeof obj.description !== "string" || obj.description.length === 0) {
      throw new WasmExecutionError(
        "Output must include a non-empty description string",
        "INVALID_OUTPUT"
      );
    }
    if (typeof obj.eventType !== "string" || obj.eventType.length === 0) {
      throw new WasmExecutionError(
        "Output must include a non-empty eventType string",
        "INVALID_OUTPUT"
      );
    }
    const size = Buffer.byteLength(JSON.stringify(obj), "utf8");
    if (size > this.limits.maxOutputBytes) {
      throw new WasmExecutionError(
        `Output size (${size}) exceeds max (${this.limits.maxOutputBytes})`,
        "INVALID_OUTPUT"
      );
    }
    return {
      description: obj.description,
      eventType: obj.eventType,
    };
  }

  private runInWorker(
    bytes: Uint8Array,
    inputJson: string,
    timeoutMs: number
  ): Promise<{
    success: boolean;
    output?: WasmParserOutput;
    errorMessage: string;
    errorType?: WasmErrorType;
    peakMemoryBytes: number;
    timedOut: boolean;
  }> {
    return new Promise((resolve) => {
      const worker = new Worker(resolveWorkerPath(), {
        workerData: {
          // Copy into a plain Buffer so it clones cleanly across threads.
          wasmBytes: Buffer.from(bytes),
          inputJson,
          maxMemoryPages: this.limits.maxMemoryPages,
          maxOutputBytes: this.limits.maxOutputBytes,
        },
      });

      let settled = false;
      const finish = (result: {
        success: boolean;
        output?: WasmParserOutput;
        errorMessage: string;
        errorType?: WasmErrorType;
        peakMemoryBytes: number;
        timedOut: boolean;
      }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        void worker.terminate();
        resolve(result);
      };

      const timer = setTimeout(() => {
        finish({
          success: false,
          errorMessage: `Execution exceeded timeout of ${timeoutMs}ms`,
          errorType: "TIMEOUT_EXCEEDED",
          peakMemoryBytes: 0,
          timedOut: true,
        });
      }, timeoutMs);

      worker.on("message", (msg: {
        success: boolean;
        output?: WasmParserOutput;
        error?: string;
        errorType?: WasmErrorType;
        peakMemoryBytes?: number;
      }) => {
        if (msg.success) {
          finish({
            success: true,
            output: msg.output,
            errorMessage: "",
            peakMemoryBytes: msg.peakMemoryBytes ?? 0,
            timedOut: false,
          });
        } else {
          finish({
            success: false,
            errorMessage: msg.error ?? "Unknown worker error",
            errorType: msg.errorType ?? "RUNTIME_TRAP",
            peakMemoryBytes: msg.peakMemoryBytes ?? 0,
            timedOut: false,
          });
        }
      });

      worker.on("error", (err) => {
        finish({
          success: false,
          errorMessage: `Worker error: ${err.message}`,
          errorType: "RUNTIME_TRAP",
          peakMemoryBytes: 0,
          timedOut: false,
        });
      });

      worker.on("exit", (code) => {
        if (!settled && code !== 0) {
          finish({
            success: false,
            errorMessage: `Worker exited with code ${code}`,
            errorType: "RUNTIME_TRAP",
            peakMemoryBytes: 0,
            timedOut: false,
          });
        }
      });
    });
  }
}
