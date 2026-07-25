// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  translateEvent,
  translateEvents,
  translateWithCache,
  registerBlueprint,
  registerUpgrade,
  matchesEventCriteria,
  hasBlueprint,
  getRegisteredContracts,
  getBlueprintCount,
  resolveSchema,
} from "../registry";
import type {
  RawEvent,
  TranslationBlueprint,
  VersionedTranslationBlueprint,
  PersistedRawEvent,
} from "../types";

const { mockGetCachedTranslation, mockSetCachedTranslation, mockIsRedisEnabled } =
  vi.hoisted(() => ({
    mockGetCachedTranslation: vi.fn(),
    mockSetCachedTranslation: vi.fn(),
    mockIsRedisEnabled: vi.fn().mockReturnValue(false),
  }));

vi.mock("../../cache/redisCache", () => ({
  getCachedTranslation: (...args: unknown[]) => mockGetCachedTranslation(...args),
  setCachedTranslation: (...args: unknown[]) => mockSetCachedTranslation(...args),
  isRedisEnabled: () => mockIsRedisEnabled(),
}));

const SAC_USDC = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const TRANSFER_TOPIC =
  "0x0000000000000000000000000000000000000000000000000000000074726e73";

function makeEvent(overrides: Partial<RawEvent> = {}): RawEvent {
  return {
    id: "test-event-1",
    contractId: SAC_USDC,
    topics: [TRANSFER_TOPIC, "0x1234", "0x5678"],
    data: "0x0000000000000000000000000000006400000000000000000000000000000000",
    ledger: 1000,
    timestamp: Math.floor(Date.now() / 1000),
    txHash: "tx-hash-001",
    ...overrides,
  };
}

function makeBlueprint(
  contractId: string,
  overrides: Partial<TranslationBlueprint> = {}
): TranslationBlueprint {
  return {
    contractId,
    contractName: `Test Contract ${contractId.slice(0, 8)}`,
    translate: vi.fn().mockReturnValue({
      description: "translated event",
      eventType: "Transfer",
    }),
    ...overrides,
  };
}

describe("translateEvent", () => {
  it("returns a translated status for a known SAC transfer event", () => {
    const event = makeEvent();
    const result = translateEvent(event);

    expect(result.status).toBe("translated");
    expect(result.description).toBeTruthy();
    expect(typeof result.description).toBe("string");
    expect(result.blueprintName).toContain("Stellar Asset Contract");
    expect(result.eventType).toBe("Transfer");
  });

  it("returns cryptic with null description when blueprint's matches rejects the event", () => {
    const contractId = "CNOMATCH000000000000000000000000000000000000000000000";

    registerBlueprint({
      contractId,
      contractName: "No Match Blueprint",
      matches: () => false,
      translate: vi.fn().mockReturnValue({ description: "should not reach", eventType: "X" }),
    });

    const event = makeEvent({ contractId, id: "no-match-1" });
    const result = translateEvent(event);

    expect(result.status).toBe("cryptic");
    expect(result.description).toBeNull();
    expect(result.blueprintName).toBe("No Match Blueprint");
  });

  it("returns cryptic with null description when blueprint's translate returns null", () => {
    const contractId = "CNULLTR000000000000000000000000000000000000000000000";

    registerBlueprint({
      contractId,
      contractName: "Null Translate Blueprint",
      translate: () => null,
    });

    const event = makeEvent({ contractId, id: "null-trans-1" });
    const result = translateEvent(event);

    expect(result.status).toBe("cryptic");
    expect(result.description).toBeNull();
    expect(result.blueprintName).toBe("Null Translate Blueprint");
  });

  it("handles errors thrown by translateEvents gracefully via translateEventSafe", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const contractId = "CTHROWBP000000000000000000000000000000000000000000000";

    registerBlueprint({
      contractId,
      contractName: "Throwing Blueprint",
      translate: () => {
        throw new Error("Blueprint crashed");
      },
    });

    const event = makeEvent({ contractId, id: "throw-1" });
    const results = translateEvents([event]);

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("cryptic");
    expect(results[0].description).toBeNull();
    expect(results[0].blueprintName).toBeNull();
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it("returns cryptic status with fallback description for an unregistered contract", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const event = makeEvent({
      contractId: "CUNREGISTERED00000000000000000000000000000000000000000000",
    });
    const result = translateEvent(event);

    expect(result.status).toBe("cryptic");
    expect(result.description).toBeTruthy();
    expect(result.description).toContain("Unregistered Contract");
    expect(result.blueprintName).toBe("Unregistered Contract");
    expect(result.eventType).toBeNull();
    expect(result.schemaVersion).toBeNull();
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});

describe("translateEvents", () => {
  it("correctly processes a batch of mixed registered and unregistered events", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const events = [
      makeEvent({ id: "evt-1", contractId: SAC_USDC }),
      makeEvent({
        id: "evt-2",
        contractId: "CUNREGISTERED00000000000000000000000000000000000000000000",
      }),
      makeEvent({ id: "evt-3", contractId: SAC_USDC }),
    ];

    const results = translateEvents(events);

    expect(results).toHaveLength(3);
    expect(results[0].status).toBe("translated");
    expect(results[1].status).toBe("cryptic");
    expect(results[2].status).toBe("translated");

    warnSpy.mockRestore();
  });

  it("never throws regardless of the raw event input shape", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const weirdEvents: RawEvent[] = [
      {
        id: "",
        contractId: "",
        topics: [],
        data: "",
        ledger: 0,
        timestamp: 0,
        txHash: "",
      },
      {
        id: "weird-1",
        contractId: "NOTAREALCONTRACT",
        topics: ["0x"],
        data: "0x",
        ledger: -1,
        timestamp: -1,
        txHash: "",
      },
      {
        id: "weird-2",
        contractId: "C" + "A".repeat(55),
        topics: ["0x0000000000000000000000000000000000000000000000000000000074726e73"],
        data: "0xnotahexvalue",
        ledger: 999999999,
        timestamp: 0,
        txHash: "x".repeat(64),
      },
      {
        id: "weird-3",
        contractId: "C" + "B".repeat(55),
        topics: [
          "0x0000000000000000000000000000000000000000000000000000000074726e73",
          "bad",
          "topics",
          "extra",
        ],
        data: "",
        ledger: 1,
        timestamp: 1,
        txHash: "y",
      },
      {
        id: "weird-4",
        contractId: "C" + "C".repeat(55),
        topics: [
          "not_a_valid_topic",
          "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF",
        ],
        data: "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF",
        ledger: 42,
        timestamp: 42,
        txHash: "z",
      },
    ];

    const results = translateEvents(weirdEvents);

    expect(results).toHaveLength(5);
    for (const result of results) {
      expect(result).toHaveProperty("raw");
      expect(result).toHaveProperty("status");
      expect(result).toHaveProperty("description");
      expect(["translated", "cryptic", "pending"]).toContain(result.status);
    }

    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe("translateWithCache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsRedisEnabled.mockReturnValue(false);
    mockGetCachedTranslation.mockResolvedValue(null);
    mockSetCachedTranslation.mockResolvedValue(undefined);
  });

  it("returns cached translation when Redis has a hit", async () => {
    const cachedResult = {
      raw: makeEvent(),
      description: "cached translation",
      status: "translated" as const,
      blueprintName: "Cached Blueprint",
      eventType: "Transfer",
      schemaVersion: "1.0.0",
    };

    mockIsRedisEnabled.mockReturnValue(true);
    mockGetCachedTranslation.mockResolvedValueOnce(cachedResult);

    const event = makeEvent({ txHash: "cache-tx-1", id: "cache-id-1" });
    const result = await translateWithCache(event);

    expect(result.description).toBe("cached translation");
    expect(mockGetCachedTranslation).toHaveBeenCalledTimes(1);
    expect(mockSetCachedTranslation).not.toHaveBeenCalled();
  });

  it("translates and stores in cache when Redis misses", async () => {
    mockIsRedisEnabled.mockReturnValue(true);
    mockGetCachedTranslation.mockResolvedValue(null);

    const event = makeEvent({ txHash: "cache-tx-2", id: "cache-id-2" });
    const result = await translateWithCache(event);

    expect(result.status).toBe("translated");
    expect(mockSetCachedTranslation).toHaveBeenCalledTimes(1);
  });

  it("builds from persisted fields when status is defined", async () => {
    mockIsRedisEnabled.mockReturnValue(false);

    const persistedEvent = {
      ...makeEvent({ txHash: "persist-tx", id: "persist-id" }),
      status: "translated" as const,
      description: "Previously translated description",
      blueprintName: "Persisted Blueprint",
      eventType: "Transfer",
      schemaVersion: "1.0.0",
    } satisfies PersistedRawEvent;

    const result = await translateWithCache(persistedEvent);

    expect(result.description).toBe("Previously translated description");
    expect(result.status).toBe("translated");
    expect(result.blueprintName).toBe("Persisted Blueprint");
  });

  it("builds from persisted fields with default status", async () => {
    mockIsRedisEnabled.mockReturnValue(false);

    const persistedEvent = {
      ...makeEvent({ txHash: "persist-tx-2", id: "persist-id-2" }),
      status: "cryptic" as const,
      description: "Some description",
    } satisfies PersistedRawEvent;

    const result = await translateWithCache(persistedEvent);

    expect(result.description).toBe("Some description");
    expect(result.status).toBe("cryptic");
  });

  it("skips caching when txHash or id is missing", async () => {
    mockIsRedisEnabled.mockReturnValue(true);

    const event = makeEvent({ txHash: "", id: "" });
    await translateWithCache(event);

    expect(mockGetCachedTranslation).not.toHaveBeenCalled();
    expect(mockSetCachedTranslation).not.toHaveBeenCalled();
  });

  it("skips cache when Redis is not enabled", async () => {
    mockIsRedisEnabled.mockReturnValue(false);

    const event = makeEvent({ txHash: "no-redis-tx", id: "no-redis-id" });
    const result = await translateWithCache(event);

    expect(result.status).toBe("translated");
    expect(mockGetCachedTranslation).not.toHaveBeenCalled();
    expect(mockSetCachedTranslation).not.toHaveBeenCalled();
  });
});

describe("registerBlueprint", () => {
  it("makes a new contract translatable via translateEvent after registration", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const contractId = "CREGISTERBP00000000000000000000000000000000000000000000";

    const blueprint = makeBlueprint(contractId, {
      contractName: "My Custom Contract",
      translate: vi.fn().mockReturnValue({
        description: "Custom contract event translated",
        eventType: "CustomEvent",
      }),
    });

    registerBlueprint(blueprint);

    const event = makeEvent({ contractId, id: "reg-1" });
    const result = translateEvent(event);

    expect(result.status).toBe("translated");
    expect(result.description).toBe("Custom contract event translated");
    expect(result.blueprintName).toBe("My Custom Contract");
    expect(result.eventType).toBe("CustomEvent");

    warnSpy.mockRestore();
  });

  it("merges a second schema for the same contract and selects the right one by ledger", () => {
    const contractId = "CMERGE00000000000000000000000000000000000000000000000000";

    const v1Blueprint = makeBlueprint(contractId, {
      contractName: "Merge Contract",
      translate: vi.fn().mockReturnValue({
        description: "v1 merged schema",
        eventType: "Transfer",
      }),
    });
    (v1Blueprint as VersionedTranslationBlueprint).validFromLedger = 100;

    const v2Blueprint = makeBlueprint(contractId, {
      contractName: "Merge Contract",
      translate: vi.fn().mockReturnValue({
        description: "v2 merged schema",
        eventType: "Transfer",
      }),
    });
    (v2Blueprint as VersionedTranslationBlueprint).validFromLedger = 500;

    registerBlueprint(v1Blueprint, v2Blueprint);

    const eventBelowBoth = makeEvent({ contractId, ledger: 50, id: "merge-below" });
    const resultBelow = translateEvent(eventBelowBoth);
    expect(resultBelow.status).toBe("cryptic");

    const eventInV1Range = makeEvent({ contractId, ledger: 200, id: "merge-v1" });
    const resultV1 = translateEvent(eventInV1Range);
    expect(resultV1.description).toBe("v1 merged schema");

    const eventInV2Range = makeEvent({ contractId, ledger: 600, id: "merge-v2" });
    const resultV2 = translateEvent(eventInV2Range);
    expect(resultV2.status).toBe("translated");
  });
});

describe("registerUpgrade", () => {
  const UPGRADE_CONTRACT = "CUPGRADE0000000000000000000000000000000000000000000000";

  beforeEach(() => {
    const blueprint = makeBlueprint(UPGRADE_CONTRACT, {
      contractName: "Upgradeable Contract",
      translate: vi.fn().mockReturnValue({
        description: "original schema",
        eventType: "Transfer",
      }),
    });
    registerBlueprint(blueprint);
  });

  it("selects the new schema for ledgers after the upgrade and the old schema for ledgers before", () => {
    const v2Mappings = [
      {
        topics: ["transfer"],
        event_structure: {
          topics: [
            { name: "from", type: "address" },
            { name: "to", type: "address" },
          ],
          data: { name: "amount", type: "i128" },
        },
        english_template: "upgraded: {from.short} to {to.short}",
      },
    ];

    registerUpgrade(UPGRADE_CONTRACT, "2.0.0", 500, v2Mappings);

    const eventBefore = makeEvent({
      contractId: UPGRADE_CONTRACT,
      ledger: 200,
      id: "upg-before",
    });
    const resultBefore = translateEvent(eventBefore);
    expect(resultBefore.description).toBe("original schema");

    const eventAfter = makeEvent({
      contractId: UPGRADE_CONTRACT,
      ledger: 600,
      id: "upg-after",
    });
    const resultAfter = translateEvent(eventAfter);
    expect(resultAfter.description).toContain("upgraded:");
  });

  it("correctly clears only the cache entries for the upgraded contract", () => {
    const OTHER_CONTRACT = "COTHER00000000000000000000000000000000000000000000000";
    const otherBlueprint = makeBlueprint(OTHER_CONTRACT, {
      contractName: "Other Contract",
      translate: vi.fn().mockReturnValue({
        description: "other contract event",
        eventType: "Transfer",
      }),
    });
    registerBlueprint(otherBlueprint);

    resolveSchema(OTHER_CONTRACT, 100);
    resolveSchema(UPGRADE_CONTRACT, 100);

    const v2Mappings = [
      {
        topics: ["transfer"],
        event_structure: {
          topics: [
            { name: "from", type: "address" },
            { name: "to", type: "address" },
          ],
          data: { name: "amount", type: "i128" },
        },
        english_template: "upgraded: {from.short} to {to.short}",
      },
    ];

    registerUpgrade(UPGRADE_CONTRACT, "2.0.0", 500, v2Mappings);

    const otherResult = resolveSchema(OTHER_CONTRACT, 100);
    expect(otherResult).not.toBeNull();
    expect(otherResult!.blueprint.contractName).toBe("Other Contract");

    const upgradedResult = resolveSchema(UPGRADE_CONTRACT, 100);
    expect(upgradedResult).not.toBeNull();
    expect(upgradedResult!.blueprint.contractName).toBe("Upgradeable Contract");
  });

  it("does nothing when upgrading a contract not in the registry", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const nonExistent = "CNONEXISTENT00000000000000000000000000000000000000000000";

    registerUpgrade(nonExistent, "1.0.0", 1, []);
    const result = resolveSchema(nonExistent, 1);
    expect(result).toBeNull();

    warnSpy.mockRestore();
  });
});

describe("matchesEventCriteria", () => {
  const testEvent: RawEvent = {
    id: "criteria-test",
    contractId: "CCRITERIATEST00000000000000000000000000000000000000000000",
    topics: [TRANSFER_TOPIC, "0xABCD1234", "0xEFGH5678"],
    data: "0x00",
    ledger: 100,
    timestamp: 1000,
    txHash: "criteria-hash",
  };

  it("matches by contractId", () => {
    expect(
      matchesEventCriteria(testEvent, { contractId: testEvent.contractId })
    ).toBe(true);

    expect(
      matchesEventCriteria(testEvent, {
        contractId: "CWRONGCONTRACT00000000000000000000000000000000000000000000",
      })
    ).toBe(false);
  });

  it("matches by topic equals (exact match)", () => {
    expect(
      matchesEventCriteria(testEvent, {
        topics: [{ index: 0, equals: TRANSFER_TOPIC }],
      })
    ).toBe(true);

    expect(
      matchesEventCriteria(testEvent, {
        topics: [{ index: 0, equals: "wrong-topic" }],
      })
    ).toBe(false);
  });

  it("matches by topic includes (case-insensitive substring)", () => {
    expect(
      matchesEventCriteria(testEvent, {
        topics: [{ index: 0, includes: "74726e73" }],
      })
    ).toBe(true);

    expect(
      matchesEventCriteria(testEvent, {
        topics: [{ index: 0, includes: "74726E73" }],
      })
    ).toBe(true);

    expect(
      matchesEventCriteria(testEvent, {
        topics: [{ index: 0, includes: "nonexistent" }],
      })
    ).toBe(false);
  });

  it("matches by topic decodedName", () => {
    expect(
      matchesEventCriteria(testEvent, {
        topics: [{ index: 0, decodedName: "transfer" }],
      })
    ).toBe(true);

    expect(
      matchesEventCriteria(testEvent, {
        topics: [{ index: 0, decodedName: "mint" }],
      })
    ).toBe(false);
  });

  it("matches multiple topic criteria in combination", () => {
    expect(
      matchesEventCriteria(testEvent, {
        contractId: testEvent.contractId,
        topics: [
          { index: 0, decodedName: "transfer" },
          { index: 1, equals: "0xABCD1234" },
        ],
      })
    ).toBe(true);

    expect(
      matchesEventCriteria(testEvent, {
        contractId: testEvent.contractId,
        topics: [
          { index: 0, decodedName: "transfer" },
          { index: 1, equals: "wrong-value" },
        ],
      })
    ).toBe(false);
  });

  it("returns true for empty criteria", () => {
    expect(matchesEventCriteria(testEvent, {})).toBe(true);
  });

  it("returns false when topic index is out of range", () => {
    expect(
      matchesEventCriteria(testEvent, {
        topics: [{ index: 99, equals: "anything" }],
      })
    ).toBe(false);
  });
});

describe("registry helpers", () => {
  it("hasBlueprint returns true for known contracts", () => {
    expect(hasBlueprint(SAC_USDC)).toBe(true);
  });

  it("hasBlueprint returns false for unknown contracts", () => {
    expect(
      hasBlueprint("CUNKNOWN99999999999999999999999999999999999999999999999")
    ).toBe(false);
  });

  it("getRegisteredContracts returns a non-empty array", () => {
    const contracts = getRegisteredContracts();
    expect(Array.isArray(contracts)).toBe(true);
    expect(contracts.length).toBeGreaterThan(0);
    expect(contracts).toContain(SAC_USDC);
  });

  it("getBlueprintCount returns a positive number", () => {
    expect(getBlueprintCount()).toBeGreaterThan(0);
  });
});
