/**
 * Test suite for the Blend Protocol Lending Pool translation blueprint.
 *
 * Fixtures are built with the real stellar-sdk XDR encoders (the same
 * approach used in decode-map-vec.test.ts and decode-amount.test.ts) since
 * Blend pool events carry a tuple-typed (Vec-encoded) data payload.
 */

import { describe, it, expect } from "vitest";
import { xdr as StellarXdr } from "stellar-sdk";
import { translateEvent } from "../registry";
import { createBlendPoolBlueprint, BLEND_POOL_CONTRACT_IDS } from "../blueprints/blend-pool";
import type { RawEvent } from "../types";

// ─── XDR fixture helpers ───────────────────────────────────────────────────────

function symbolHex(name: string): string {
  return "0x" + StellarXdr.ScVal.scvSymbol(Buffer.from(name)).toXDR("hex");
}

function addressHex(fillByte: number): string {
  const scAddress = StellarXdr.ScAddress.scAddressTypeContract(Buffer.alloc(32, fillByte));
  return "0x" + StellarXdr.ScVal.scvAddress(scAddress).toXDR("hex");
}

function addressScVal(fillByte: number): StellarXdr.ScVal {
  const scAddress = StellarXdr.ScAddress.scAddressTypeContract(Buffer.alloc(32, fillByte));
  return StellarXdr.ScVal.scvAddress(scAddress);
}

function u32Hex(value: number): string {
  return "0x" + StellarXdr.ScVal.scvU32(value).toXDR("hex");
}

function i128ScVal(value: bigint): StellarXdr.ScVal {
  const hi = value >> 64n;
  const lo = value & 0xffffffffffffffffn;
  const parts = new StellarXdr.Int128Parts({
    hi: StellarXdr.Int64.fromString(hi.toString()),
    lo: StellarXdr.Uint64.fromString(lo.toString()),
  });
  return StellarXdr.ScVal.scvI128(parts);
}

function vecHex(values: StellarXdr.ScVal[]): string {
  return "0x" + StellarXdr.ScVal.scvVec(values).toXDR("hex");
}

// ─── Contract IDs ─────────────────────────────────────────────────────────────

const POOL_MAINNET_CONTRACT = "CAJJZSGMMM3PD7N33TAPHGBUGTB43OC73HVIK2L2G6BNGGGYOSSYBXBD";
const POOL_TESTNET_CONTRACT = "CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF";

// ─── Topic fixtures ─────────────────────────────────────────────────────────────

const ASSET_TOPIC = addressHex(20);
const FROM_TOPIC = addressHex(21);
const USER_TOPIC = addressHex(22);

// ─── Event fixtures ─────────────────────────────────────────────────────────────

const MOCK_SUPPLY_EVENT: RawEvent = {
  id: "0000300-0",
  contractId: POOL_TESTNET_CONTRACT,
  topics: [symbolHex("supply"), ASSET_TOPIC, FROM_TOPIC],
  data: vecHex([i128ScVal(1_000_000_000n), i128ScVal(980_000_000n)]),
  ledger: 61_000_001,
  timestamp: Math.floor(Date.now() / 1000) - 20,
  txHash: "d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4",
};

const MOCK_WITHDRAW_EVENT: RawEvent = {
  id: "0000300-1",
  contractId: POOL_TESTNET_CONTRACT,
  topics: [symbolHex("withdraw"), ASSET_TOPIC, FROM_TOPIC],
  data: vecHex([i128ScVal(500_000_000n), i128ScVal(490_000_000n)]),
  ledger: 61_000_002,
  timestamp: Math.floor(Date.now() / 1000) - 40,
  txHash: "e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5",
};

const MOCK_BORROW_EVENT: RawEvent = {
  id: "0000300-2",
  contractId: POOL_TESTNET_CONTRACT,
  topics: [symbolHex("borrow"), ASSET_TOPIC, FROM_TOPIC],
  data: vecHex([i128ScVal(300_000_000n), i128ScVal(310_000_000n)]),
  ledger: 61_000_003,
  timestamp: Math.floor(Date.now() / 1000) - 60,
  txHash: "f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6",
};

const MOCK_REPAY_EVENT: RawEvent = {
  id: "0000300-3",
  contractId: POOL_TESTNET_CONTRACT,
  topics: [symbolHex("repay"), ASSET_TOPIC, FROM_TOPIC],
  data: vecHex([i128ScVal(300_000_000n), i128ScVal(310_000_000n)]),
  ledger: 61_000_004,
  timestamp: Math.floor(Date.now() / 1000) - 80,
  txHash: "07070707070707070707070707070707070707070707070707070707070707",
};

const MOCK_LIQUIDATE_EVENT: RawEvent = {
  id: "0000300-4",
  contractId: POOL_TESTNET_CONTRACT,
  topics: [symbolHex("fill_auction"), USER_TOPIC, u32Hex(0)],
  data: vecHex([addressScVal(23), i128ScVal(750_000_000n)]),
  ledger: 61_000_005,
  timestamp: Math.floor(Date.now() / 1000) - 100,
  txHash: "18181818181818181818181818181818181818181818181818181818181818",
};

// ─── supply ────────────────────────────────────────────────────────────────────

describe("Blend Pool blueprint — supply", () => {
  it("translates a supply event to plain English", () => {
    const result = translateEvent(MOCK_SUPPLY_EVENT);

    expect(result.status).toBe("translated");
    expect(result.eventType).toBe("Supply");
    expect(result.blueprintName).toBe("Blend Lending Pool");
    expect(result.description).toContain("supplied");
  });

  it("translates supply to Spanish, French, and Chinese with distinct output", () => {
    const es = translateEvent(MOCK_SUPPLY_EVENT, undefined, "es");
    const fr = translateEvent(MOCK_SUPPLY_EVENT, undefined, "fr");
    const zh = translateEvent(MOCK_SUPPLY_EVENT, undefined, "zh");

    expect(es.eventType).toBe("Suministro");
    expect(fr.eventType).toBe("Approvisionnement");
    expect(zh.eventType).toBe("存入");
    expect(new Set([es.description, fr.description, zh.description]).size).toBe(3);
  });
});

// ─── withdraw ──────────────────────────────────────────────────────────────────

describe("Blend Pool blueprint — withdraw", () => {
  it("translates a withdraw event to plain English", () => {
    const result = translateEvent(MOCK_WITHDRAW_EVENT);

    expect(result.status).toBe("translated");
    expect(result.eventType).toBe("Withdraw");
    expect(result.description).toContain("withdrew");
  });

  it("translates withdraw to Spanish, French, and Chinese with distinct output", () => {
    const es = translateEvent(MOCK_WITHDRAW_EVENT, undefined, "es");
    const fr = translateEvent(MOCK_WITHDRAW_EVENT, undefined, "fr");
    const zh = translateEvent(MOCK_WITHDRAW_EVENT, undefined, "zh");

    expect(es.eventType).toBe("Retiro");
    expect(fr.eventType).toBe("Retrait");
    expect(zh.eventType).toBe("提取");
    expect(new Set([es.description, fr.description, zh.description]).size).toBe(3);
  });
});

// ─── borrow ────────────────────────────────────────────────────────────────────

describe("Blend Pool blueprint — borrow", () => {
  it("translates a borrow event to plain English", () => {
    const result = translateEvent(MOCK_BORROW_EVENT);

    expect(result.status).toBe("translated");
    expect(result.eventType).toBe("Borrow");
    expect(result.description).toContain("borrowed");
  });

  it("translates borrow to Spanish, French, and Chinese with distinct output", () => {
    const es = translateEvent(MOCK_BORROW_EVENT, undefined, "es");
    const fr = translateEvent(MOCK_BORROW_EVENT, undefined, "fr");
    const zh = translateEvent(MOCK_BORROW_EVENT, undefined, "zh");

    expect(es.eventType).toBe("Préstamo");
    expect(fr.eventType).toBe("Emprunt");
    expect(zh.eventType).toBe("借款");
    expect(new Set([es.description, fr.description, zh.description]).size).toBe(3);
  });
});

// ─── repay ─────────────────────────────────────────────────────────────────────

describe("Blend Pool blueprint — repay", () => {
  it("translates a repay event to plain English", () => {
    const result = translateEvent(MOCK_REPAY_EVENT);

    expect(result.status).toBe("translated");
    expect(result.eventType).toBe("Repay");
    expect(result.description).toContain("repaid");
  });

  it("translates repay to Spanish, French, and Chinese with distinct output", () => {
    const es = translateEvent(MOCK_REPAY_EVENT, undefined, "es");
    const fr = translateEvent(MOCK_REPAY_EVENT, undefined, "fr");
    const zh = translateEvent(MOCK_REPAY_EVENT, undefined, "zh");

    expect(es.eventType).toBe("Pago");
    expect(fr.eventType).toBe("Remboursement");
    expect(zh.eventType).toBe("还款");
    expect(new Set([es.description, fr.description, zh.description]).size).toBe(3);
  });
});

// ─── liquidate ─────────────────────────────────────────────────────────────────

describe("Blend Pool blueprint — liquidate", () => {
  it("translates a fill_auction(auction_type=0) event to a liquidation description", () => {
    const result = translateEvent(MOCK_LIQUIDATE_EVENT);

    expect(result.status).toBe("translated");
    expect(result.eventType).toBe("Liquidate");
    expect(result.description).toContain("liquidated");
  });

  it("translates liquidate to Spanish, French, and Chinese with distinct output", () => {
    const es = translateEvent(MOCK_LIQUIDATE_EVENT, undefined, "es");
    const fr = translateEvent(MOCK_LIQUIDATE_EVENT, undefined, "fr");
    const zh = translateEvent(MOCK_LIQUIDATE_EVENT, undefined, "zh");

    expect(es.eventType).toBe("Liquidación");
    expect(fr.eventType).toBe("Liquidation");
    expect(zh.eventType).toBe("清算");
    expect(new Set([es.description, fr.description, zh.description]).size).toBe(3);
  });

  it("does not translate fill_auction events for non-user auction types (bad debt / interest)", () => {
    const blueprint = createBlendPoolBlueprint(POOL_TESTNET_CONTRACT);
    const badDebtAuction: RawEvent = {
      ...MOCK_LIQUIDATE_EVENT,
      topics: [symbolHex("fill_auction"), USER_TOPIC, u32Hex(1)],
    };

    expect(blueprint.translate(badDebtAuction, "en")).toBeNull();
  });
});

// ─── Edge cases and rejection ─────────────────────────────────────────────────

describe("Blend Pool blueprint — edge cases", () => {
  it("returns null for an unrecognised event name", () => {
    const blueprint = createBlendPoolBlueprint(POOL_MAINNET_CONTRACT);
    const unknownEvent: RawEvent = {
      ...MOCK_SUPPLY_EVENT,
      topics: [symbolHex("set_admin"), ASSET_TOPIC, FROM_TOPIC],
    };

    expect(blueprint.translate(unknownEvent, "en")).toBeNull();
  });

  it("returns null for an empty topics array without throwing", () => {
    const blueprint = createBlendPoolBlueprint(POOL_MAINNET_CONTRACT);
    const emptyTopicsEvent: RawEvent = { ...MOCK_SUPPLY_EVENT, topics: [] };

    expect(() => blueprint.translate(emptyTopicsEvent, "en")).not.toThrow();
    expect(blueprint.translate(emptyTopicsEvent, "en")).toBeNull();
  });

  it("does not translate events from contracts not registered as a Blend Pool", () => {
    const foreignContractEvent: RawEvent = {
      ...MOCK_SUPPLY_EVENT,
      contractId: "CFOREIGN000000000000000000000000000000000000000000000000000",
    };
    const result = translateEvent(foreignContractEvent);

    expect(result.status).toBe("cryptic");
    expect(result.blueprintName).toContain("Unregistered");
  });
});

// ─── Blueprint factory & matches() ─────────────────────────────────────────────

describe("createBlendPoolBlueprint", () => {
  it("creates a blueprint with the correct contract ID and name", () => {
    const blueprint = createBlendPoolBlueprint(POOL_MAINNET_CONTRACT);

    expect(blueprint.contractId).toBe(POOL_MAINNET_CONTRACT);
    expect(blueprint.contractName).toBe("Blend Lending Pool");
  });

  it("blueprint.translate() returns a result for each Blend event type", () => {
    const blueprint = createBlendPoolBlueprint(POOL_TESTNET_CONTRACT);

    expect(blueprint.translate(MOCK_SUPPLY_EVENT, "en")).not.toBeNull();
    expect(blueprint.translate(MOCK_WITHDRAW_EVENT, "en")).not.toBeNull();
    expect(blueprint.translate(MOCK_BORROW_EVENT, "en")).not.toBeNull();
    expect(blueprint.translate(MOCK_REPAY_EVENT, "en")).not.toBeNull();
    expect(blueprint.translate(MOCK_LIQUIDATE_EVENT, "en")).not.toBeNull();
  });

  it("matches() accepts events from its own contract ID", () => {
    const blueprint = createBlendPoolBlueprint(POOL_TESTNET_CONTRACT);
    expect(blueprint.matches?.(MOCK_SUPPLY_EVENT)).toBe(true);
  });

  it("matches() rejects events from unrelated contracts", () => {
    const blueprint = createBlendPoolBlueprint(POOL_TESTNET_CONTRACT);
    const unrelatedEvent: RawEvent = {
      ...MOCK_SUPPLY_EVENT,
      contractId: "CUNRELATED00000000000000000000000000000000000000000000",
    };

    expect(blueprint.matches?.(unrelatedEvent)).toBe(false);
  });

  it("BLEND_POOL_CONTRACT_IDS exports the canonical mainnet and testnet pool IDs", () => {
    expect(BLEND_POOL_CONTRACT_IDS).toContain(POOL_MAINNET_CONTRACT);
    expect(BLEND_POOL_CONTRACT_IDS).toContain(POOL_TESTNET_CONTRACT);
  });
});

// ─── Multi-language consistency ───────────────────────────────────────────────

describe("Blend Pool blueprint — multi-language consistency", () => {
  const languages = ["en", "es", "fr", "zh"] as const;
  const events = [
    { name: "supply", event: MOCK_SUPPLY_EVENT },
    { name: "withdraw", event: MOCK_WITHDRAW_EVENT },
    { name: "borrow", event: MOCK_BORROW_EVENT },
    { name: "repay", event: MOCK_REPAY_EVENT },
    { name: "liquidate", event: MOCK_LIQUIDATE_EVENT },
  ];

  for (const { name, event } of events) {
    it(`produces four distinct, non-empty descriptions for ${name}`, () => {
      const descriptions = languages.map((lang) => {
        const result = translateEvent(event, undefined, lang);
        expect(result.status).toBe("translated");
        expect(result.description).toBeTruthy();
        expect(result.eventType).toBeTruthy();
        return result.description as string;
      });

      expect(new Set(descriptions).size).toBe(languages.length);
    });
  }
});
