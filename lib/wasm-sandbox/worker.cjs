/**
 * WASM sandbox worker (CommonJS for worker_threads reliability).
 *
 * Instantiates the guest with ONLY env.memory (host-capped).
 * No WASI, no fs, no network, no Node builtins exposed to the guest.
 *
 * Guest ABI:
 *   alloc(size: i32) -> i32
 *   dealloc(ptr: i32, size: i32)?  // optional
 *   translate(in_ptr: i32, in_len: i32) -> i32  // out_ptr
 *   get_output_len() -> i32
 */
"use strict";

const { parentPort, workerData } = require("worker_threads");

function readVarUint(bytes, start) {
  let value = 0;
  let offset = start;
  for (let shift = 0; shift <= 28; shift += 7) {
    if (offset >= bytes.length) throw new Error("Invalid WASM section length");
    const byte = bytes[offset++];
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return { value, offset };
  }
  throw new Error("Invalid WASM section length");
}

function hasDefinedMemory(bytes) {
  // WebAssembly.Module.imports/exports do not reveal an unexported private
  // memory. Inspect the standard memory section after compilation succeeds.
  let offset = 8; // magic + version
  while (offset < bytes.length) {
    const sectionId = bytes[offset++];
    const length = readVarUint(bytes, offset);
    const sectionEnd = length.offset + length.value;
    if (sectionEnd > bytes.length) throw new Error("Invalid WASM section length");
    if (sectionId === 5) {
      return readVarUint(bytes, length.offset).value > 0;
    }
    offset = sectionEnd;
  }
  return false;
}

function readImportedMemoryLimits(bytes) {
  // Module.imports() identifies the memory but does not expose its limits.
  // Read the descriptor only after compilation and the single-import check.
  let offset = 8;
  while (offset < bytes.length) {
    const sectionId = bytes[offset++];
    const length = readVarUint(bytes, offset);
    const sectionEnd = length.offset + length.value;
    if (sectionEnd > bytes.length) throw new Error("Invalid WASM section length");
    if (sectionId === 2) {
      const count = readVarUint(bytes, length.offset);
      if (count.value !== 1) {
        throw new Error("Forbidden imports in worker: expected only env.memory");
      }
      let cursor = count.offset;
      // Skip the UTF-8 module and field names, already checked via imports().
      for (let name = 0; name < 2; name += 1) {
        const size = readVarUint(bytes, cursor);
        cursor = size.offset + size.value;
      }
      if (bytes[cursor++] !== 2) {
        throw new Error("Forbidden imports in worker: expected only env.memory");
      }
      const flags = readVarUint(bytes, cursor);
      // This ABI uses unshared 32-bit memory. Memory64 and shared-memory
      // imports need a different host/guest contract and are not supported.
      if ((flags.value & ~1) !== 0) {
        throw new Error("Forbidden memory type: expected unshared 32-bit env.memory");
      }
      const minimum = readVarUint(bytes, flags.offset);
      const maximum = flags.value & 1
        ? readVarUint(bytes, minimum.offset).value
        : undefined;
      return { minimum: minimum.value, maximum };
    }
    offset = sectionEnd;
  }
  throw new Error("Forbidden imports in worker: expected only env.memory");
}

// Tables allocate outside env.memory. Cap their aggregate declared maxima,
// not only their initial sizes, before instantiation can allocate or run start.
const MAX_TABLE_ELEMENTS = 65_536;
const MAX_TABLES = 32;

function validateDefinedTables(bytes) {
  let offset = 8;
  while (offset < bytes.length) {
    const sectionId = bytes[offset++];
    const length = readVarUint(bytes, offset);
    const sectionEnd = length.offset + length.value;
    if (sectionEnd > bytes.length) throw new Error("Invalid WASM section length");
    if (sectionId === 4) {
      const count = readVarUint(bytes, length.offset);
      if (count.value > MAX_TABLES) {
        throw new Error(`MEMORY_LIMIT_EXCEEDED: guest declares more than ${MAX_TABLES} tables`);
      }
      let cursor = count.offset;
      let totalMaximum = 0;
      for (let i = 0; i < count.value; i++) {
        // The supported ABI admits ordinary nullable funcref/externref tables.
        // Reject extended table initializers and typed-reference encodings
        // rather than guessing where their limits begin.
        const referenceType = bytes[cursor++];
        if (referenceType !== 0x70 && referenceType !== 0x6f) {
          throw new Error("Forbidden table type: expected nullable funcref or externref");
        }
        const flags = readVarUint(bytes, cursor);
        if (flags.value === 0) {
          throw new Error("MEMORY_LIMIT_EXCEEDED: every guest table requires an explicit maximum");
        }
        if (flags.value !== 1) {
          throw new Error("Forbidden table type: expected bounded unshared 32-bit table");
        }
        const minimum = readVarUint(bytes, flags.offset);
        const maximum = readVarUint(bytes, minimum.offset);
        cursor = maximum.offset;
        if (cursor > sectionEnd) throw new Error("Invalid WASM table section");
        totalMaximum += maximum.value;
        if (totalMaximum > MAX_TABLE_ELEMENTS) {
          throw new Error(`MEMORY_LIMIT_EXCEEDED: table maxima exceed ${MAX_TABLE_ELEMENTS} total elements`);
        }
      }
      if (cursor !== sectionEnd) throw new Error("Invalid WASM table section");
      return;
    }
    offset = sectionEnd;
  }
}

async function main() {
  if (!parentPort) {
    throw new Error("wasm-sandbox worker must run as a Worker thread");
  }

  const { wasmBytes, inputJson, maxMemoryPages, maxOutputBytes } = workerData;
  if (!wasmBytes || typeof inputJson !== "string" || !maxMemoryPages) {
    throw new Error("Missing required workerData fields");
  }

  const bytes =
    wasmBytes instanceof Uint8Array
      ? wasmBytes
      : Buffer.isBuffer(wasmBytes)
        ? new Uint8Array(wasmBytes)
        : new Uint8Array(wasmBytes);

  const module = await WebAssembly.compile(bytes);

  // Require exactly the one host-capped memory. A module with no imports
  // could otherwise instantiate with its own private, unbounded memory.
  const moduleImports = WebAssembly.Module.imports(module);
  if (
    moduleImports.length !== 1 ||
    moduleImports[0].module !== "env" ||
    moduleImports[0].name !== "memory" ||
    moduleImports[0].kind !== "memory"
  ) {
    throw new Error("Forbidden imports in worker: expected only env.memory");
  }

  if (hasDefinedMemory(bytes)) {
    throw new Error("Forbidden defined memory: guest must use only env.memory");
  }

  validateDefinedTables(bytes);

  const memoryLimits = readImportedMemoryLimits(bytes);
  if (memoryLimits.minimum > maxMemoryPages) {
    throw new Error(
      `MEMORY_LIMIT_EXCEEDED: guest requires ${memoryLimits.minimum} initial pages; host allows ${maxMemoryPages}`
    );
  }
  const memory = new WebAssembly.Memory({
    initial: memoryLimits.minimum,
    maximum: Math.min(memoryLimits.maximum ?? maxMemoryPages, maxMemoryPages),
  });

  const imports = {
    env: {
      memory,
    },
  };

  const instance = await WebAssembly.instantiate(module, imports);
  const exports = instance.exports;

  if (
    typeof exports.alloc !== "function" ||
    typeof exports.translate !== "function" ||
    typeof exports.get_output_len !== "function"
  ) {
    throw new Error("Missing required exports: alloc, translate, get_output_len");
  }

  const inputBytes = Buffer.from(inputJson, "utf8");
  const inPtr = exports.alloc(inputBytes.length);
  if (!inPtr) {
    throw new Error("alloc returned null pointer for input");
  }

  // memory.buffer may detach after grow; always re-read.
  new Uint8Array(memory.buffer).set(inputBytes, inPtr);

  let outPtr;
  try {
    outPtr = exports.translate(inPtr, inputBytes.length);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`RUNTIME_TRAP: ${msg}`);
  }

  let outStr;
  try {
    // WASM i32 values arrive as signed JS numbers; pointers address memory
    // as unsigned wasm32 offsets, never Buffer's negative-relative indexes.
    if (!Number.isInteger(outPtr) || outPtr < -0x80000000 || outPtr > 0x7fffffff) {
      throw new Error("RUNTIME_TRAP: translate returned a non-i32 output pointer");
    }
    outPtr >>>= 0;
    if (!outPtr) {
      throw new Error("translate returned null pointer");
    }

    const outLen = exports.get_output_len();
    if (!Number.isInteger(outLen) || outLen < -0x80000000 || outLen > 0x7fffffff) {
      throw new Error("INVALID_OUTPUT: get_output_len returned a non-i32 output length");
    }
    if (outLen <= 0) {
      throw new Error(`Invalid output length: ${outLen}`);
    }
    if (outLen > maxOutputBytes) {
      throw new Error(
        `OUTPUT_TOO_LARGE: ${outLen} bytes exceeds max ${maxOutputBytes}`
      );
    }
    if (outPtr + outLen > memory.buffer.byteLength) {
      throw new Error(
        `RUNTIME_TRAP: output range [${outPtr}, ${outPtr + outLen}) exceeds memory`
      );
    }

    // Output may alias input. Decode to an owned string before guest cleanup
    // can overwrite that allocation or grow/detach its memory buffer.
    const outBytes = Buffer.from(memory.buffer).subarray(outPtr, outPtr + outLen);
    outStr = outBytes.toString("utf8");
  } finally {
    if (typeof exports.dealloc === "function") {
      try {
        exports.dealloc(inPtr, inputBytes.length);
      } catch {
        // ignore dealloc failures after translate
      }
    }
  }

  let output;
  try {
    output = JSON.parse(outStr);
  } catch (err) {
    throw new Error(
      `INVALID_OUTPUT_JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  parentPort.postMessage({
    success: true,
    output,
    peakMemoryBytes: memory.buffer.byteLength,
  });
}

main().catch((err) => {
  if (parentPort) {
    parentPort.postMessage({
      success: false,
      error: err instanceof Error ? err.message : String(err),
      errorType: classifyError(err),
    });
  }
});

function classifyError(err) {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.startsWith("Forbidden ")) return "FORBIDDEN_IMPORTS";
  if (msg.startsWith("MEMORY_LIMIT_EXCEEDED:")) return "MEMORY_LIMIT_EXCEEDED";
  if (msg.includes("OUTPUT_TOO_LARGE")) return "INVALID_OUTPUT";
  if (msg.includes("INVALID_OUTPUT")) return "INVALID_OUTPUT";
  if (msg.includes("RUNTIME_TRAP") || msg.includes("unreachable") || msg.includes("out of bounds")) {
    return "RUNTIME_TRAP";
  }
  if (msg.includes("memory") && msg.includes("Maximum")) return "MEMORY_LIMIT_EXCEEDED";
  return "RUNTIME_TRAP";
}
