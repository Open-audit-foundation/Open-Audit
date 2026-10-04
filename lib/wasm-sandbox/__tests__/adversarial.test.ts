import { describe, it, expect, beforeEach } from "vitest";
import { WasmSandboxRunner } from "../runner";
import { validateWasmModule } from "../validate-module";
import { loadFixture, SAMPLE_EVENT_INPUT } from "./fixtures";

describe("WASM sandbox adversarial suite (#405)", () => {
  let runner: WasmSandboxRunner;

  beforeEach(() => {
    runner = new WasmSandboxRunner({
      maxExecutionTimeMs: 400,
      maxMemoryPages: 8, // 512 KiB — keeps memory_bomb fast
      maxOutputBytes: 4 * 1024,
    });
  });

  it("contains infinite loops via TIMEOUT_EXCEEDED without crashing the host", async () => {
    const result = await runner.execute(
      loadFixture("infinite_loop.wasm"),
      SAMPLE_EVENT_INPUT
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errorType).toBe("TIMEOUT_EXCEEDED");
      expect(result.stats.timedOut).toBe(true);
    }
    // Host still responsive:
    expect(1 + 1).toBe(2);
  });

  it("contains memory exhaustion attempts", async () => {
    const result = await runner.execute(
      loadFixture("memory_bomb.wasm"),
      SAMPLE_EVENT_INPUT
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(["RUNTIME_TRAP", "MEMORY_LIMIT_EXCEEDED", "UNKNOWN_ERROR"]).toContain(
        result.error.errorType
      );
    }
  });

  it("rejects a hidden private memory alongside env.memory", async () => {
    // Valid WASM with one imported env.memory and one unexported defined memory.
    // Module.imports/exports alone cannot reveal the second memory.
    const bytes = Uint8Array.from([
      0, 97, 115, 109, 1, 0, 0, 0,
      2, 16, 1, 3, 101, 110, 118, 6, 109, 101, 109, 111, 114, 121, 2, 1, 1, 1,
      5, 4, 1, 1, 1, 1,
    ]);
    await expect(WebAssembly.compile(bytes)).resolves.toBeDefined();
    const result = await runner.execute(bytes, SAMPLE_EVENT_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errorType).toBe("FORBIDDEN_IMPORTS");
      expect(result.error.message).toMatch(/defined memory/);
    }
  });

  it("contains out-of-bounds memory access traps", async () => {
    const result = await runner.execute(
      loadFixture("oob_read.wasm"),
      SAMPLE_EVENT_INPUT
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errorType).toBe("RUNTIME_TRAP");
    }
  });

  it("rejects signed output pointers that would alias the end of memory", async () => {
    const bytes = loadFixture("negative_output_pointer.wasm");
    // The module is valid, but its i32 -128 is address 0xffffff80, not an
    // end-relative Buffer offset into the JSON stored at byte 65408.
    await expect(WebAssembly.compile(bytes)).resolves.toBeDefined();
    const result = await runner.execute(bytes, SAMPLE_EVENT_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errorType).toBe("RUNTIME_TRAP");
      expect(result.error.message).toMatch(/output range/);
      expect(result.stats.timedOut).toBe(false);
    }
  });

  it("rejects non-i32 output pointers before unsigned coercion can wrap them", async () => {
    const bytes = loadFixture("non_i32_output_pointer.wasm");
    // A valid WASM f64 export returns 2^32 + 1024; blindly applying >>> 0
    // would turn that malformed ABI return into the valid JSON offset 1024.
    await expect(WebAssembly.compile(bytes)).resolves.toBeDefined();
    const result = await runner.execute(bytes, SAMPLE_EVENT_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errorType).toBe("RUNTIME_TRAP");
      expect(result.error.message).toMatch(/non-i32 output pointer/);
      expect(result.stats.timedOut).toBe(false);
    }
  });

  it("rejects output lengths before integer coercion can hide an oversized claim", async () => {
    const bytes = loadFixture("non_i32_output_length.wasm");
    // A valid WASM f64 export returns 2^32 + 39. Coercing it with | 0
    // would hide the oversized claim and accept the 39-byte JSON sentinel.
    await expect(WebAssembly.compile(bytes)).resolves.toBeDefined();
    const result = await runner.execute(bytes, SAMPLE_EVENT_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errorType).toBe("INVALID_OUTPUT");
      expect(result.error.message).toMatch(/non-i32 output length/);
      expect(result.stats.timedOut).toBe(false);
    }
  });

  it("rejects malformed guest output", async () => {
    const result = await runner.execute(
      loadFixture("malformed_output.wasm"),
      SAMPLE_EVENT_INPUT
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errorType).toBe("INVALID_OUTPUT");
    }
  });

  it("rejects oversized guest output claims", async () => {
    const result = await runner.execute(
      loadFixture("oversized_output.wasm"),
      SAMPLE_EVENT_INPUT
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errorType).toBe("INVALID_OUTPUT");
    }
  });

  it("rejects WASI imports before execution (zero ambient capabilities)", async () => {
    const bytes = loadFixture("wasi_attempt.wasm");
    const module = await WebAssembly.compile(bytes);
    expect(() => validateWasmModule(module)).toThrow(/Forbidden WASM import/);

    const result = await runner.execute(bytes, SAMPLE_EVENT_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errorType).toBe("FORBIDDEN_IMPORTS");
    }
  });

  it("rejects filesystem / Node API imports", async () => {
    const bytes = loadFixture("fs_attempt.wasm");
    const module = await WebAssembly.compile(bytes);
    expect(() => validateWasmModule(module)).toThrow(/Forbidden WASM import/);

    const result = await runner.execute(bytes, SAMPLE_EVENT_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errorType).toBe("FORBIDDEN_IMPORTS");
    }
  });
});
