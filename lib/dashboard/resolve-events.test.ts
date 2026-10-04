import { describe, it, expect, vi } from "vitest";

// lib/translator/registry.ts pulls in lib/telemetry.ts, which initializes an
// OpenTelemetry NodeSDK at import time. That module is unrelated to the
// dashboard event-resolution logic under test here, so it's stubbed out to
// keep this a focused unit test.
vi.mock("@/lib/telemetry", () => ({
  captureExceptionSync: vi.fn(),
}));

import { resolveDisplayEvents, toDashboardEvent } from "./resolve-events";
import type { RawEvent, TranslationBlueprint } from "@/lib/translator/types";
import type { PersistedRawEvent } from "@/lib/translator/registry";

function makeRawEvent(overrides: Partial<RawEvent> = {}): RawEvent {
  return {
    id: "0000001-0",
    contractId: "CUNKNOWNCONTRACTIDNOTINANYBLUEPRINTREGISTRY000000000",
    topics: ["0xdeadbeef"],
    data: "0xdeadbeef",
    ledger: 1,
    timestamp: 0,
    txHash: "abc123",
    ...overrides,
  };
}

describe("resolveDisplayEvents", () => {
  it("translates raw mock events", () => {
    const raw = [makeRawEvent()];
    const emptyBlueprints = new Map<string, TranslationBlueprint>();

    const result = resolveDisplayEvents(raw, emptyBlueprints, "en");

    // No blueprint is registered for this contract, so the registry marks it
    // cryptic. Getting this back at all proves translation ran (bug 1/2: the
    // mock path must still be translated client-side).
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("cryptic");
    expect(result[0].raw).toEqual(raw[0]);
  });

  it("does not run mock raw events through translation twice", () => {
    const raw = [makeRawEvent(), makeRawEvent({ id: "0000001-1" })];
    const emptyBlueprints = new Map<string, TranslationBlueprint>();

    const result = resolveDisplayEvents(raw, emptyBlueprints, "en");

    // One TranslatedEvent per RawEvent -- if translation ran twice (the old
    // events/allEvents duplication bug) callers would see doubled entries.
    expect(result).toHaveLength(raw.length);
  });

  it("preserves stored translations without requiring a local blueprint", () => {
    const dbEvents: PersistedRawEvent[] = [
      {
        ...makeRawEvent(),
        description: "Sent 100 USDC from GABC...WXYZ to GDEF...UVWX",
        status: "translated",
        blueprintName: "Stellar Asset Contract (SAC)",
        eventType: "Transfer",
        schemaVersion: null,
      },
    ];
    const emptyBlueprints = new Map<string, TranslationBlueprint>();

    const result = resolveDisplayEvents(dbEvents, emptyBlueprints, "en");

    // Re-translating would re-derive these fields from `raw` and, for this
    // unregistered contract, overwrite the description/status/blueprintName
    // that the database already computed.
    expect(result[0].raw).toBe(dbEvents[0]);
    expect(result[0].description).toBe(
      "Sent 100 USDC from GABC...WXYZ to GDEF...UVWX"
    );
    expect(result[0].status).toBe("translated");
    expect(result[0].blueprintName).toBe("Stellar Asset Contract (SAC)");
  });

  it("returns no events for an empty source", () => {
    const result = resolveDisplayEvents([], new Map(), "en");
    expect(result).toHaveLength(0);
  });

  it.each(["translated", "cryptic"] as const)(
    "preserves a stored community %s result even when a custom ABI is available",
    (status) => {
      const event: PersistedRawEvent = {
        ...makeRawEvent(),
        status,
        description: status === "translated" ? "Stored community translation" : null,
        blueprintName: "Community contract",
        eventType: status === "translated" ? "Transfer" : null,
        schemaVersion: "community-v1",
        parserProvenance: "community-wasm",
        sandboxError: status === "cryptic" ? "TIMEOUT" : undefined,
      };
      const translate = vi.fn().mockReturnValue({
        description: "Local override must not replace a sandbox outcome",
        eventType: "Override",
      });
      const blueprints = new Map<string, TranslationBlueprint>([
        [event.contractId, { contractId: event.contractId, contractName: "Local", translate }],
      ]);

      const [result] = resolveDisplayEvents([event], blueprints, "en");

      expect(result.description).toBe(event.description);
      expect(result.status).toBe(status);
      expect(result.parserProvenance).toBe("community-wasm");
      expect(result.sandboxError).toBe(event.sandboxError);
      expect(result.schemaVersion).toBe("community-v1");
      expect(translate).not.toHaveBeenCalled();
    }
  );

  it("keeps custom ABI translation for native events and preserves mixed-source order", () => {
    const native: PersistedRawEvent = {
      ...makeRawEvent({ id: "native" }),
      status: "translated",
      description: "Old native translation",
      parserProvenance: "native",
    };
    const community: PersistedRawEvent = {
      ...makeRawEvent({ id: "community", contractId: "CCOMMUNITY" }),
      status: "translated",
      description: "Stored community translation",
      parserProvenance: "community-wasm",
    };
    const raw = makeRawEvent({ id: "raw" });
    const translate = vi.fn().mockReturnValue({
      description: "Viewer custom translation",
      eventType: "Custom",
    });
    const blueprints = new Map<string, TranslationBlueprint>([
      [native.contractId, { contractId: native.contractId, contractName: "Local", translate }],
    ]);

    const results = resolveDisplayEvents([native, community, raw], blueprints, "en");

    expect(results.map((event) => event.raw.id)).toEqual(["native", "community", "raw"]);
    expect(results.map((event) => event.description)).toEqual([
      "Viewer custom translation",
      "Stored community translation",
      "Viewer custom translation",
    ]);
    expect(translate).toHaveBeenCalledTimes(2);
  });
});

describe("toDashboardEvent", () => {
  it.each([
    ["native", "native"],
    ["community-wasm", "community-wasm"],
    [null, undefined],
    ["unrecognised-parser", undefined],
  ])("validates stored parser provenance %s", (stored, expected) => {
    const event = toDashboardEvent({
      ...makeRawEvent(),
      status: "cryptic",
      description: null,
      blueprintName: "Stored contract",
      eventType: null,
      schemaVersion: "v2",
      parserProvenance: stored,
      sandboxError: "TIMEOUT",
    });

    expect(event.parserProvenance).toBe(expected);
    expect(event.sandboxError).toBe("TIMEOUT");
    expect(event.status).toBe("cryptic");
    expect(event.schemaVersion).toBe("v2");
  });

  it("leaves an invalid stored status available for raw translation", () => {
    const event = toDashboardEvent({
      ...makeRawEvent(),
      status: "not-a-translation-status",
      parserProvenance: null,
      sandboxError: null,
    });

    expect(event.status).toBeUndefined();
    expect(event.parserProvenance).toBeUndefined();
    expect(event.sandboxError).toBeUndefined();
  });
});
