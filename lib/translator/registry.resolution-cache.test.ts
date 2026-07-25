import { describe, it, expect, beforeEach } from "vitest";
import {
  resolveSchema,
  registerBlueprint,
  getResolutionCacheSize,
  getResolutionCacheMax,
} from "./registry";
import type { TranslationBlueprint } from "./types";

const TEST_CONTRACT = "CTESTCACHEXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";

function makeBlueprint(contractId: string): TranslationBlueprint {
  return {
    contractId,
    contractName: "Cache Test Token",
    validFromLedger: 1,
    events: [],
    fields: {},
  } as unknown as TranslationBlueprint;
}

describe("RESOLUTION_CACHE bounds (issue #301)", () => {
  beforeEach(() => {
    registerBlueprint(makeBlueprint(TEST_CONTRACT));
  });

  it("never exceeds RESOLUTION_CACHE_MAX under heavy historical replay", () => {
    const max = getResolutionCacheMax();
    for (let ledger = 1; ledger <= max * 3; ledger++) {
      resolveSchema(TEST_CONTRACT, ledger);
      expect(getResolutionCacheSize()).toBeLessThanOrEqual(max);
    }
    expect(getResolutionCacheSize()).toBeLessThanOrEqual(max);
  });

  it("still resolves a schema after eviction churn", () => {
    const max = getResolutionCacheMax();
    for (let ledger = 1; ledger <= max * 2; ledger++) {
      resolveSchema(TEST_CONTRACT, ledger);
    }
    const schema = resolveSchema(TEST_CONTRACT, 1);
    expect(schema).not.toBeNull();
    expect(schema!.blueprint).toBeDefined();
    expect(schema!.blueprint.contractName).toBe("Cache Test Token");
  });

  it("evicts least-recently-used entries when over capacity", () => {
    const max = getResolutionCacheMax();
    // Fill the cache
    for (let ledger = 1; ledger <= max; ledger++) {
      resolveSchema(TEST_CONTRACT, ledger);
    }
    const sizeAtCapacity = getResolutionCacheSize();
    expect(sizeAtCapacity).toBeLessThanOrEqual(max);
    // Push past capacity
    for (let ledger = max + 1; ledger <= max * 2; ledger++) {
      resolveSchema(TEST_CONTRACT, ledger);
    }
    expect(getResolutionCacheSize()).toBeLessThanOrEqual(max);
  });
});
