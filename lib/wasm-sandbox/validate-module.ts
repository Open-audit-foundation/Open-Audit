/**
 * Static validation of a compiled WASM module before instantiation.
 *
 * Policy (threat model §2):
 * - Only import allowed: env.memory (host-provided, capped).
 * - Any WASI / filesystem / network / Node API import → reject.
 * - Required exports: alloc, translate, get_output_len (dealloc optional).
 */

import { WasmExecutionError } from "./types";

const ALLOWED_IMPORTS = new Set(["env.memory"]);

const REQUIRED_EXPORTS = ["alloc", "translate", "get_output_len"] as const;

export function validateWasmModule(module: WebAssembly.Module): void {
  const imports = WebAssembly.Module.imports(module);
  for (const imp of imports) {
    const key = `${imp.module}.${imp.name}`;
    if (!ALLOWED_IMPORTS.has(key)) {
      throw new WasmExecutionError(
        `Forbidden WASM import "${key}". Community parsers may only import env.memory ` +
          `(host-capped linear memory). No WASI, filesystem, network, or Node APIs.`,
        "FORBIDDEN_IMPORTS",
        { import: imp }
      );
    }
    if (imp.kind !== "memory") {
      throw new WasmExecutionError(
        `Import "${key}" must be a memory import (got ${imp.kind}).`,
        "FORBIDDEN_IMPORTS",
        { import: imp }
      );
    }
  }

  const hasMemoryImport = imports.some(
    (i) => i.module === "env" && i.name === "memory" && i.kind === "memory"
  );
  if (!hasMemoryImport) {
    throw new WasmExecutionError(
      "WASM module must import env.memory so the host can enforce the memory ceiling.",
      "INVALID_EXPORTS"
    );
  }

  if (imports.length !== 1) {
    throw new WasmExecutionError(
      "WASM module must import exactly one host-provided env.memory.",
      "FORBIDDEN_IMPORTS"
    );
  }

  const exports = WebAssembly.Module.exports(module);
  const exportNames = new Set(exports.map((e) => e.name));
  for (const required of REQUIRED_EXPORTS) {
    if (!exportNames.has(required)) {
      throw new WasmExecutionError(
        `WASM module missing required export "${required}". ` +
          `Required: ${REQUIRED_EXPORTS.join(", ")} (dealloc optional).`,
        "INVALID_EXPORTS"
      );
    }
  }

  // Guest must not also export its own unbounded memory.
  const memoryExport = exports.find((e) => e.name === "memory" && e.kind === "memory");
  if (memoryExport) {
    throw new WasmExecutionError(
      "WASM module must not export its own memory; import env.memory from the host instead.",
      "FORBIDDEN_IMPORTS"
    );
  }
}

/**
 * Returns true when the module's import list is empty of ambient capabilities
 * beyond the single allowed env.memory import.
 */
export function hasOnlyMemoryImport(module: WebAssembly.Module): boolean {
  const imports = WebAssembly.Module.imports(module);
  return (
    imports.length === 1 &&
    imports[0].module === "env" &&
    imports[0].name === "memory" &&
    imports[0].kind === "memory"
  );
}
