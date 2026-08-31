import { describe, it, expect, beforeEach } from "vitest";
import { translateEvent, registerUpgrade } from "./registry";
import type { RawEvent } from "./types";

const SAC_USDC = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const TRANSFER_TOPIC = "0x0000000000000000000000000000000000000000000000000000000074726e73";

const createMockEvent = (ledger: number): RawEvent => ({
  id: `event-${ledger}`,
  contractId: SAC_USDC,
  topics: [TRANSFER_TOPIC, "0x123", "0x456"],
  data: "0x789",
  ledger,
  timestamp: 123456789,
  txHash: "tx-hash",
});

describe("Translation Registry Versioning", () => {
  it("resolves the correct schema version based on ledger sequence", () => {
    // We'll use the registerUpgrade to simulate versions for testing
    // Since the registry is a singleton, we should be careful or use a fresh mock if possible.
    // Here we'll just register two versions and check.
    
    const v1Mappings = [
      {
        topics: ["transfer"],
        event_structure: {
          topics: [{ name: "from", type: "address" }, { name: "to", type: "address" }],
          data: { name: "amount", type: "i128" }
        },
        english_template: "v1: {from.short} to {to.short}"
      }
    ];

    const v2Mappings = [
      {
        topics: ["transfer"],
        event_structure: {
          topics: [{ name: "from", type: "address" }, { name: "to", type: "address" }],
          data: { name: "amount", type: "i128" }
        },
        english_template: "v2: {from.short} transferred to {to.short}"
      }
    ];

    // Register v1 from ledger 100
    registerUpgrade(SAC_USDC, "1.0.0", 100, v1Mappings);
    // Register v2 from ledger 500
    registerUpgrade(SAC_USDC, "2.0.0", 500, v2Mappings);

    // Test ledger < 100 (should use default 1.0.0 hardcoded one if it exists, or v1 if we closed it)
    // Actually, our buildRegistry registers SAC_USDC with version 1.0.0 from ledger 0.
    // Our registerUpgrade adds to the schemas array.

    const eventOld = createMockEvent(50);
    const eventV1 = createMockEvent(200);
    const eventV2 = createMockEvent(600);

    const transOld = translateEvent(eventOld);
    const transV1 = translateEvent(eventV1);
    const transV2 = translateEvent(eventV2);

    expect(transV1.description).toContain("v1:");
    expect(transV2.description).toContain("v2:");
  });

  it("handles historical replay correctly across schema boundaries", () => {
    const eventAtBoundary1 = createMockEvent(499);
    const eventAtBoundary2 = createMockEvent(500);

    const trans1 = translateEvent(eventAtBoundary1);
    const trans2 = translateEvent(eventAtBoundary2);

    expect(trans1.description).toContain("v1:");
    expect(trans2.description).toContain("v2:");
  });

  it("invalidates cache when a new upgrade is registered", () => {
    const event = createMockEvent(1000);
    
    // First translation (should be v2)
    const trans1 = translateEvent(event);
    expect(trans1.description).toContain("v2:");

    // Register v3 from ledger 800
    const v3Mappings = [
      {
        topics: ["transfer"],
        event_structure: {
          topics: [{ name: "from", type: "address" }, { name: "to", type: "address" }],
          data: { name: "amount", type: "i128" }
        },
        english_template: "v3: {from.short} moved to {to.short}"
      }
    ];
    registerUpgrade(SAC_USDC, "3.0.0", 800, v3Mappings);

    // Second translation (should now be v3 due to cache invalidation)
    const trans2 = translateEvent(event);
    expect(trans2.description).toContain("v3:");
  });
});
