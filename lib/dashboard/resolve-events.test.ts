import { describe, it, expect, vi } from "vitest";

// lib/translator/registry.ts pulls in lib/telemetry.ts, which initializes an
// OpenTelemetry NodeSDK at import time. That module is unrelated to the
// dashboard event-resolution logic under test here, so it's stubbed out to
// keep this a focused unit test.
vi.mock("@/lib/telemetry", () => ({
  captureExceptionSync: vi.fn(),
}));

import { resolveDisplayEvents } from "./resolve-events";
import type { RawEvent, TranslatedEvent, TranslationBlueprint } from "@/lib/translator/types";

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
  it("translates raw mock events exactly once when useMockData is true", () => {
    const raw = [makeRawEvent()];
    const emptyBlueprints = new Map<string, TranslationBlueprint>();

    const result = resolveDisplayEvents(true, raw, [], emptyBlueprints, "en");

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

    const result = resolveDisplayEvents(true, raw, [], emptyBlueprints, "en");

    // One TranslatedEvent per RawEvent -- if translation ran twice (the old
    // events/allEvents duplication bug) callers would see doubled entries.
    expect(result).toHaveLength(raw.length);
  });

  it("passes database-sourced TranslatedEvents through unchanged", () => {
    const dbEvents: TranslatedEvent[] = [
      {
        raw: makeRawEvent(),
        description: "Sent 100 USDC from GABC...WXYZ to GDEF...UVWX",
        status: "translated",
        blueprintName: "Stellar Asset Contract (SAC)",
        eventType: "Transfer",
        schemaVersion: null,
      },
    ];
    const emptyBlueprints = new Map<string, TranslationBlueprint>();

    const result = resolveDisplayEvents(false, [], dbEvents, emptyBlueprints, "en");

    // Re-translating would re-derive these fields from `raw` and, for this
    // unregistered contract, overwrite the description/status/blueprintName
    // that the database already computed. Identity here proves the API
    // response is used as-is.
    expect(result).toBe(dbEvents);
    expect(result[0].description).toBe(
      "Sent 100 USDC from GABC...WXYZ to GDEF...UVWX"
    );
    expect(result[0].status).toBe("translated");
    expect(result[0].blueprintName).toBe("Stellar Asset Contract (SAC)");
  });

  it("ignores raw mock events and any leftover db events when useMockData is false but rawEvents is populated", () => {
    const raw = [makeRawEvent()];
    const dbEvents: TranslatedEvent[] = [];

    const result = resolveDisplayEvents(false, raw, dbEvents, new Map(), "en");

    expect(result).toBe(dbEvents);
    expect(result).toHaveLength(0);
  });
});
