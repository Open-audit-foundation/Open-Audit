import { describe, it, expect, beforeEach } from "vitest";
import { WasmSandboxRunner } from "../runner";
import { hasOnlyMemoryImport, validateWasmModule } from "../validate-module";
import { loadFixture, SAMPLE_EVENT_INPUT } from "./fixtures";

describe("WasmSandboxRunner happy path", () => {
  let runner: WasmSandboxRunner;

  beforeEach(() => {
    runner = new WasmSandboxRunner({ maxExecutionTimeMs: 2000, maxMemoryPages: 16 });
  });

  it("translates a sample event via the echo community parser", async () => {
    const bytes = loadFixture("echo_parser.wasm");
    const module = await WebAssembly.compile(bytes);
    validateWasmModule(module);
    expect(hasOnlyMemoryImport(module)).toBe(true);

    const result = await runner.execute(bytes, SAMPLE_EVENT_INPUT);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.output.eventType).toBe("transfer");
      expect(result.output.description).toContain("Community parser");
      expect(result.stats.timedOut).toBe(false);
      expect(result.stats.peakMemoryBytes).toBeGreaterThan(0);
      expect(result.stats.peakMemoryBytes).toBeLessThanOrEqual(16 * 64 * 1024);
    }
  });

  it("reads in-place output before deallocating its input buffer", async () => {
    const result = await runner.execute(
      loadFixture("in_place_output.wasm"),
      SAMPLE_EVENT_INPUT
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.output).toEqual({
        description: "In-place parser output",
        eventType: "transfer",
      });
      // The fixture overwrites input and grows memory in dealloc, so this also
      // proves cleanup still executes after the host consumes the output.
      expect(result.stats.peakMemoryBytes).toBe(2 * 64 * 1024);
      expect(result.stats.timedOut).toBe(false);
    }
  });

  it("serializes input only once for validation and execution", async () => {
    let serializations = 0;
    const input = {
      ...SAMPLE_EVENT_INPUT,
      toJSON() {
        serializations += 1;
        if (serializations > 1) throw new Error("Input was serialized twice");
        return SAMPLE_EVENT_INPUT;
      },
    };

    const result = await runner.execute(loadFixture("echo_parser.wasm"), input);
    expect(result.success).toBe(true);
    expect(serializations).toBe(1);
  });

  it("executes the size-checked snapshot when input changes during loading", async () => {
    const input = { ...SAMPLE_EVENT_INPUT };
    const pending = runner.execute(loadFixture("echo_parser.wasm"), input);
    // execute has validated the input, then yielded while loading the bytes.
    // Re-serializing here would bypass the host cap and overflow guest memory.
    input.data = "x".repeat(300 * 1024);

    const result = await pending;
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.output.eventType).toBe("transfer");
    }
  });

  it("rejects oversized input before spawning a worker", async () => {
    const big = {
      ...SAMPLE_EVENT_INPUT,
      data: "x".repeat(300 * 1024),
    };
    const result = await runner.execute(loadFixture("echo_parser.wasm"), big);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errorType).toBe("INVALID_INPUT");
    }
  });

  it("rejects missing contractId", async () => {
    const result = await runner.execute(loadFixture("echo_parser.wasm"), {
      ...SAMPLE_EVENT_INPUT,
      contractId: "",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errorType).toBe("INVALID_INPUT");
    }
  });
});

describe("WasmSandboxRunner imported memory limits", () => {
  it("honors a two-page imported minimum within an eight-page host cap", async () => {
    const runner = new WasmSandboxRunner({
      maxExecutionTimeMs: 2000,
      maxMemoryPages: 8,
    });

    // Both the data segment and heap live in the second page.
    const result = await runner.execute(
      loadFixture("imported_memory_min2.wasm"),
      SAMPLE_EVENT_INPUT
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.output.eventType).toBe("transfer");
      expect(result.output.description).toContain("Community parser");
      expect(result.stats.peakMemoryBytes).toBe(2 * 64 * 1024);
      expect(result.stats.timedOut).toBe(false);
    }
  });

  it("honors a one-page imported maximum below an eight-page host cap", async () => {
    const runner = new WasmSandboxRunner({
      maxExecutionTimeMs: 2000,
      maxMemoryPages: 8,
    });

    // The guest traps unless memory.grow fails at its declared maximum.
    const result = await runner.execute(
      loadFixture("imported_memory_max1.wasm"),
      SAMPLE_EVENT_INPUT
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.output.eventType).toBe("transfer");
      expect(result.output.description).toContain("Community parser");
      expect(result.stats.peakMemoryBytes).toBe(64 * 1024);
      expect(result.stats.timedOut).toBe(false);
    }
  });

  it("rejects a two-page imported minimum above a one-page host cap", async () => {
    const runner = new WasmSandboxRunner({
      maxExecutionTimeMs: 2000,
      maxMemoryPages: 1,
    });

    const result = await runner.execute(
      loadFixture("imported_memory_min2.wasm"),
      SAMPLE_EVENT_INPUT
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errorType).toBe("MEMORY_LIMIT_EXCEEDED");
      expect(result.stats.timedOut).toBe(false);
    }
  });
});
