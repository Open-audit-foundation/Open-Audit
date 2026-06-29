import { describe, it, expect } from "vitest";
import {
  translateEvent,
  registerBlueprint,
  getContractRegistryEntry,
  updateContractMetadata,
} from "./registry";
import type { RawEvent, TranslationBlueprint } from "./types";

const MOCK_CONTRACT = "CDEPRECATED000000000000000000000000000000000000000000000000";

const createMockEvent = (ledger: number): RawEvent => ({
  id: `event-${ledger}`,
  contractId: MOCK_CONTRACT,
  topics: ["0x0000000000000000000000000000000000000000000000000000000074657374"],
  data: "0x1234",
  ledger,
  timestamp: 123456789,
  txHash: "tx-hash",
});

describe("Blueprint Deprecation and Ownership Model", () => {
  it("registers a blueprint with ownership metadata and active status", () => {
    const blueprint: TranslationBlueprint = {
      contractId: MOCK_CONTRACT,
      contractName: "Test Contract",
      owner: "Open Audit Foundation",
      maintainers: ["admin@openaudit.org"],
      status: "active",
      translate: () => ({ description: "Test translated", eventType: "Test" }),
    };

    registerBlueprint(blueprint);

    const entry = getContractRegistryEntry(MOCK_CONTRACT);
    expect(entry).toBeDefined();
    expect(entry?.owner).toBe("Open Audit Foundation");
    expect(entry?.maintainers).toContain("admin@openaudit.org");
    expect(entry?.status).toBe("active");

    const trans = translateEvent(createMockEvent(100));
    expect(trans.blueprintStatus).toBe("active");
    expect(trans.blueprintOwner).toBe("Open Audit Foundation");
  });

  it("updates contract metadata to deprecated status and reflects in translations", () => {
    const updated = updateContractMetadata(MOCK_CONTRACT, {
      status: "deprecated",
      owner: "Legacy Maintainers",
    });

    expect(updated).toBe(true);

    const entry = getContractRegistryEntry(MOCK_CONTRACT);
    expect(entry?.status).toBe("deprecated");
    expect(entry?.owner).toBe("Legacy Maintainers");

    const trans = translateEvent(createMockEvent(200));
    expect(trans.blueprintStatus).toBe("deprecated");
    expect(trans.blueprintOwner).toBe("Legacy Maintainers");
  });
});
