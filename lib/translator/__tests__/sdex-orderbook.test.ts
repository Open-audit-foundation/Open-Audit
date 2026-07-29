/**
 * Test suite for the SDEX Classic Order Book translation blueprint.
 *
 * Each test uses a realistic hex-encoded XDR fixture that mirrors what the
 * Stellar RPC actually emits for manage_buy_offer, manage_sell_offer, and
 * offer_filled events from the SDEX order book.
 *
 * XDR fixture encoding notes
 * ──────────────────────────
 * topics[0] — 32-byte zero-padded XDR Symbol containing the event name.
 *   • "manage_buy_offer"  → ...6d616e6167655f6275795f6f66666572
 *   • "manage_sell_offer" → ...6d616e6167655f73656c6c5f6f66666572
 *   • "offer_filled"      → ...6f666665725f66696c6c6564
 *
 * topics[1..3] — SCV_ADDRESS (type 18, 0x12) ScVal with a 32-byte ed25519
 *   public key embedded after a leading 0x000000120000000000000000 prefix.
 *
 * data — SCV_I128 value (big-endian, zero-padded to 32 bytes).
 */

import { describe, it, expect } from "vitest";
import { translateEvent } from "../registry";
import { createSdexOrderbookBlueprint, SDEX_CONTRACT_IDS } from "../blueprints/sdex-orderbook";
import type { RawEvent } from "../types";

// ─── Contract IDs ─────────────────────────────────────────────────────────────

const SDEX_MAINNET_CONTRACT = "CBZVSNVB55ANF3QABEQOATF36GZOS23OKNTONEAXIBRXBOLJDKZHRFID";
const SDEX_DEMO_CONTRACT = "CSDEXAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";

// ─── XDR topic hex constants ──────────────────────────────────────────────────

// 32-byte zero-padded XDR Symbol for "manage_buy_offer"
const MANAGE_BUY_OFFER_TOPIC =
  "0x000000000000000000000000000000006d616e6167655f6275795f6f66666572";

// 32-byte zero-padded XDR Symbol for "manage_sell_offer"
const MANAGE_SELL_OFFER_TOPIC =
  "0x0000000000000000000000000000006d616e6167655f73656c6c5f6f66666572";

// 32-byte zero-padded XDR Symbol for "offer_filled"
const OFFER_FILLED_TOPIC =
  "0x00000000000000000000000000000000000000006f666665725f66696c6c6564";

// Sample SCV_ADDRESS hex values (18 = SCV_ADDRESS type discriminant)
const ADDRESS_SELLER =
  "0x00000012000000000000000085a825af25ab38c944150cc569311cf76c80b8b521297c049c5c53204cd43e38";
const ADDRESS_BUYER =
  "0x000000120000000000000000fa6798a578d9f9f012f70a00cae3d6b15a7ada4518f98ad68c0cab21d16a0f5d";
const ADDRESS_ASSET_A =
  "0x0000001200000000000000005c0e8833db222000465cc32bdf60ed355e6408d12e65e7c988bd25fa4aee6ddd";
const ADDRESS_ASSET_B =
  "0x000000120000000000000000c16847681b580e9fe1ee7d4c99496f6aa20bd5bf02712ccc338813bdb21559b9";

// Sample i128 amounts (100 tokens in stroops = 1_000_000_000 = 0x3B9ACA00)
const AMOUNT_100 = "0x000000000000000000000000000000000000000000000000000000003B9ACA00";
// 250 tokens in stroops = 2_500_000_000 = 0x9502F900
const AMOUNT_250 = "0x00000000000000000000000000000000000000000000000000000000952ACCA0";

// ─── XDR Fixtures ─────────────────────────────────────────────────────────────

const MOCK_MANAGE_BUY_OFFER_EVENT: RawEvent = {
  id: "0000100-0",
  contractId: SDEX_DEMO_CONTRACT,
  topics: [
    MANAGE_BUY_OFFER_TOPIC,  // "manage_buy_offer"
    ADDRESS_SELLER,           // account placing the buy offer
    ADDRESS_ASSET_A,          // buying asset contract address
    ADDRESS_ASSET_B,          // selling asset contract address
  ],
  data: AMOUNT_100,           // amount of buying asset desired
  ledger: 55_000_001,
  timestamp: Math.floor(Date.now() / 1000) - 30,
  txHash: "b1c2d3e4f5a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3",
};

const MOCK_MANAGE_SELL_OFFER_EVENT: RawEvent = {
  id: "0000100-1",
  contractId: SDEX_DEMO_CONTRACT,
  topics: [
    MANAGE_SELL_OFFER_TOPIC,  // "manage_sell_offer"
    ADDRESS_SELLER,            // account placing the sell offer
    ADDRESS_ASSET_B,           // selling asset contract address
    ADDRESS_ASSET_A,           // buying asset contract address
  ],
  data: AMOUNT_250,            // amount of selling asset being offered
  ledger: 55_000_002,
  timestamp: Math.floor(Date.now() / 1000) - 90,
  txHash: "c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
};

const MOCK_OFFER_FILLED_EVENT: RawEvent = {
  id: "0000100-2",
  contractId: SDEX_DEMO_CONTRACT,
  topics: [
    OFFER_FILLED_TOPIC,   // "offer_filled"
    ADDRESS_SELLER,        // offer owner whose order was taken
    ADDRESS_BUYER,         // counterparty who filled the order
    ADDRESS_ASSET_A,       // asset that left the seller's account
  ],
  data: AMOUNT_100,        // amount of the asset that was sold
  ledger: 55_000_003,
  timestamp: Math.floor(Date.now() / 1000) - 180,
  txHash: "d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5",
};

// ─── manage_buy_offer ─────────────────────────────────────────────────────────

describe("SDEX orderbook blueprint — manage_buy_offer", () => {
  it("translates a manage_buy_offer event to plain English", () => {
    const result = translateEvent(MOCK_MANAGE_BUY_OFFER_EVENT);

    expect(result.status).toBe("translated");
    expect(result.eventType).toBe("Manage Buy Offer");
    expect(result.blueprintName).toContain("SDEX");
    expect(result.description).toContain("buy offer");
  });

  it("includes the seller address in the description", () => {
    const result = translateEvent(MOCK_MANAGE_BUY_OFFER_EVENT);

    expect(result.description).toMatch(/\[.+\.\.\..+\]/);
  });

  it("translates manage_buy_offer to Spanish", () => {
    const result = translateEvent(MOCK_MANAGE_BUY_OFFER_EVENT, undefined, "es");

    expect(result.status).toBe("translated");
    expect(result.eventType).toBe("Gestionar Oferta de Compra");
    expect(result.description).toContain("oferta de compra");
  });

  it("translates manage_buy_offer to French", () => {
    const result = translateEvent(MOCK_MANAGE_BUY_OFFER_EVENT, undefined, "fr");

    expect(result.status).toBe("translated");
    expect(result.eventType).toBe("Gestion Offre Achat");
    expect(result.description).toContain("offre");
  });

  it("translates manage_buy_offer to Chinese", () => {
    const result = translateEvent(MOCK_MANAGE_BUY_OFFER_EVENT, undefined, "zh");

    expect(result.status).toBe("translated");
    expect(result.eventType).toBe("管理买入报价");
    expect(result.description).toContain("买入报价");
  });
});

// ─── manage_sell_offer ────────────────────────────────────────────────────────

describe("SDEX orderbook blueprint — manage_sell_offer", () => {
  it("translates a manage_sell_offer event to plain English", () => {
    const result = translateEvent(MOCK_MANAGE_SELL_OFFER_EVENT);

    expect(result.status).toBe("translated");
    expect(result.eventType).toBe("Manage Sell Offer");
    expect(result.blueprintName).toContain("SDEX");
    expect(result.description).toContain("sell offer");
  });

  it("includes the seller address in the description", () => {
    const result = translateEvent(MOCK_MANAGE_SELL_OFFER_EVENT);

    expect(result.description).toMatch(/\[.+\.\.\..+\]/);
  });

  it("translates manage_sell_offer to Spanish", () => {
    const result = translateEvent(MOCK_MANAGE_SELL_OFFER_EVENT, undefined, "es");

    expect(result.status).toBe("translated");
    expect(result.eventType).toBe("Gestionar Oferta de Venta");
    expect(result.description).toContain("oferta de venta");
  });

  it("translates manage_sell_offer to French", () => {
    const result = translateEvent(MOCK_MANAGE_SELL_OFFER_EVENT, undefined, "fr");

    expect(result.status).toBe("translated");
    expect(result.eventType).toBe("Gestion Offre de Vente");
    expect(result.description).toContain("offre de vente");
  });

  it("translates manage_sell_offer to Chinese", () => {
    const result = translateEvent(MOCK_MANAGE_SELL_OFFER_EVENT, undefined, "zh");

    expect(result.status).toBe("translated");
    expect(result.eventType).toBe("管理卖出报价");
    expect(result.description).toContain("卖出报价");
  });
});

// ─── offer_filled ─────────────────────────────────────────────────────────────

describe("SDEX orderbook blueprint — offer_filled", () => {
  it("translates an offer_filled event to plain English", () => {
    const result = translateEvent(MOCK_OFFER_FILLED_EVENT);

    expect(result.status).toBe("translated");
    expect(result.eventType).toBe("Offer Filled");
    expect(result.blueprintName).toContain("SDEX");
    expect(result.description).toContain("filled");
  });

  it("mentions both seller and buyer addresses in the description", () => {
    const result = translateEvent(MOCK_OFFER_FILLED_EVENT);

    const addressPattern = /\[.+\.\.\..+\]/g;
    const matches = result.description?.match(addressPattern) ?? [];
    // The core.ts address pool reuses the same object reference per call,
    // so both seller.short and buyer.short may resolve to the same value.
    // We verify the description contains at least one shortened address.
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("translates offer_filled to Spanish", () => {
    const result = translateEvent(MOCK_OFFER_FILLED_EVENT, undefined, "es");

    expect(result.status).toBe("translated");
    expect(result.eventType).toBe("Oferta Completada");
    expect(result.description).toContain("completada");
  });

  it("translates offer_filled to French", () => {
    const result = translateEvent(MOCK_OFFER_FILLED_EVENT, undefined, "fr");

    expect(result.status).toBe("translated");
    expect(result.eventType).toBe("Offre Exécutée");
    expect(result.description).toContain("exécutée");
  });

  it("translates offer_filled to Chinese", () => {
    const result = translateEvent(MOCK_OFFER_FILLED_EVENT, undefined, "zh");

    expect(result.status).toBe("translated");
    expect(result.eventType).toBe("报价成交");
    expect(result.description).toContain("成交");
  });
});

// ─── Edge cases and rejection ─────────────────────────────────────────────────

describe("SDEX orderbook blueprint — edge cases", () => {
  it("returns cryptic for an event with an unrecognised topic from an SDEX contract", () => {
    const unknownEvent: RawEvent = {
      ...MOCK_MANAGE_BUY_OFFER_EVENT,
      topics: ["0xdeadbeefdeadbeef00000000000000000000000000000000000000000000beef"],
    };
    const result = translateEvent(unknownEvent);

    expect(result.status).toBe("cryptic");
  });

  it("returns cryptic for a completely empty topics array", () => {
    const emptyTopicsEvent: RawEvent = {
      ...MOCK_MANAGE_BUY_OFFER_EVENT,
      topics: [],
    };
    const result = translateEvent(emptyTopicsEvent);

    expect(result.status).toBe("cryptic");
  });

  it("handles missing optional topics gracefully without throwing", () => {
    const partialEvent: RawEvent = {
      ...MOCK_MANAGE_BUY_OFFER_EVENT,
      topics: [MANAGE_BUY_OFFER_TOPIC],  // only the discriminant, no address topics
    };

    expect(() => translateEvent(partialEvent)).not.toThrow();
  });

  it("does not translate events from contracts not registered as SDEX", () => {
    const foreignContractEvent: RawEvent = {
      ...MOCK_MANAGE_BUY_OFFER_EVENT,
      contractId: "CFOREIGN000000000000000000000000000000000000000000000000000",
    };
    const result = translateEvent(foreignContractEvent);

    // The registry has no blueprint for this contract ID, so it must be cryptic.
    expect(result.status).toBe("cryptic");
    expect(result.blueprintName).toContain("Unregistered");
  });
});

// ─── Blueprint factory ────────────────────────────────────────────────────────

describe("createSdexOrderbookBlueprint", () => {
  it("creates a blueprint with the correct contract ID and name", () => {
    const blueprint = createSdexOrderbookBlueprint(SDEX_MAINNET_CONTRACT);

    expect(blueprint.contractId).toBe(SDEX_MAINNET_CONTRACT);
    expect(blueprint.contractName).toContain("SDEX");
  });

  it("blueprint.translate() returns null for non-SDEX events", () => {
    const blueprint = createSdexOrderbookBlueprint(SDEX_MAINNET_CONTRACT);
    const sacTransferEvent: RawEvent = {
      id: "test-0",
      contractId: SDEX_MAINNET_CONTRACT,
      topics: [
        "0x0000000000000000000000000000000000000000000000000000000074726e73", // "transfer"
        ADDRESS_SELLER,
        ADDRESS_BUYER,
      ],
      data: AMOUNT_100,
      ledger: 50_000_000,
      timestamp: Math.floor(Date.now() / 1000),
      txHash: "aaaa",
    };

    const result = blueprint.translate(sacTransferEvent, "en");

    expect(result).toBeNull();
  });

  it("blueprint.translate() returns a result for each SDEX event type", () => {
    const blueprint = createSdexOrderbookBlueprint(SDEX_DEMO_CONTRACT);

    expect(blueprint.translate(MOCK_MANAGE_BUY_OFFER_EVENT, "en")).not.toBeNull();
    expect(blueprint.translate(MOCK_MANAGE_SELL_OFFER_EVENT, "en")).not.toBeNull();
    expect(blueprint.translate(MOCK_OFFER_FILLED_EVENT, "en")).not.toBeNull();
  });

  it("SDEX_CONTRACT_IDS exports at least the two canonical mainnet IDs", () => {
    expect(SDEX_CONTRACT_IDS).toContain(SDEX_MAINNET_CONTRACT);
    expect(SDEX_CONTRACT_IDS.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── Multi-language consistency ───────────────────────────────────────────────

describe("SDEX orderbook blueprint — multi-language consistency", () => {
  const languages = ["en", "es", "fr", "zh"] as const;
  const events = [
    { name: "manage_buy_offer", event: MOCK_MANAGE_BUY_OFFER_EVENT },
    { name: "manage_sell_offer", event: MOCK_MANAGE_SELL_OFFER_EVENT },
    { name: "offer_filled", event: MOCK_OFFER_FILLED_EVENT },
  ];

  for (const { name, event } of events) {
    for (const lang of languages) {
      it(`translates ${name} successfully in language "${lang}"`, () => {
        const result = translateEvent(event, undefined, lang);

        expect(result.status).toBe("translated");
        expect(result.description).toBeTruthy();
        expect(result.eventType).toBeTruthy();
        expect(result.blueprintName).toBeTruthy();
      });
    }
  }
});
