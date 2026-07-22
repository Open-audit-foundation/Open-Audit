/**
 * Test suite for the Soroswap Router translation blueprint.
 *
 * Each test uses a realistic hex-encoded XDR fixture that mirrors what the
 * Soroswap Router contract emits for swap, add liquidity, and remove
 * liquidity events.
 *
 * XDR fixture encoding notes
 * ──────────────────────────
 * topics[0] — 32-byte zero-padded XDR Symbol containing the event name.
 *   • "swap"     → ...73776170
 *   • "add"      → ...616464
 *   • "remove"   → ...72656d6f7665
 *
 * topics[1..] — additional topics if present.
 *
 * data — serialized event payload:
 *   swap: Vec<Address>(path) + Vec<i128>(amounts) + Address(to)
 *   add/remove: token_a, token_b, pair, amount_a, amount_b, liquidity, to
 */

import { describe, it, expect } from "vitest";
import { translateEvent } from "../registry";
import {
  createSoroswapRouterBlueprint,
  SOROSWAP_CONTRACT_IDS,
} from "../blueprints/soroswap-router";
import type { RawEvent } from "../types";

// ─── Contract IDs ─────────────────────────────────────────────────────────────

const SOROSWAP_MAINNET_CONTRACT = "CAG5LRYQ5JVEUI5TEID72EYOVX44TTUJT5BQR2J6J77FH65PCCFAJDDH";
const SOROSWAP_DEMO_CONTRACT = "CSOROSWAPAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";

// ─── XDR topic hex constants ──────────────────────────────────────────────────

// 32-byte zero-padded XDR Symbol for "swap"
const SWAP_TOPIC =
  "0x0000000000000000000000000000000000000000000000000000000073776170";

// 32-byte zero-padded XDR Symbol for "add"
const ADD_TOPIC =
  "0x00000000000000000000000000000000000000000000000000000000616464";

// 32-byte zero-padded XDR Symbol for "remove"
const REMOVE_TOPIC =
  "0x0000000000000000000000000000000000000000000000000000000072656d6f7665";

// Sample SCV_ADDRESS hex values (type 18 = 0x12)
const ADDRESS_TOKEN_A =
  "0x00000012000000000000000085a825af25ab38c944150cc569311cf76c80b8b521297c049c5c53204cd43e38";
const ADDRESS_TOKEN_B =
  "0x000000120000000000000000fa6798a578d9f9f012f70a00cae3d6b15a7ada4518f98ad68c0cab21d16a0f5d";
const ADDRESS_PAIR =
  "0x0000001200000000000000005c0e8833db222000465cc32bdf60ed355e6408d12e65e7c988bd25fa4aee6ddd";
const ADDRESS_TO =
  "0x000000120000000000000000c16847681b580e9fe1ee7d4c99496f6aa20bd5bf02712ccc338813bdb21559b9";

// Sample i128 amounts (100 tokens in stroops = 1_000_000_000 = 0x3B9ACA00)
const AMOUNT_100 = "0x000000000000000000000000000000000000000000000000000000003B9ACA00";
// 250 tokens in stroops = 2_500_000_000 = 0x9502F900
const AMOUNT_250 = "0x00000000000000000000000000000000000000000000000000000000950ACCA0";

// ─── XDR Fixtures ─────────────────────────────────────────────────────────────

const MOCK_SWAP_EVENT: RawEvent = {
  id: "0000100-0",
  contractId: SOROSWAP_DEMO_CONTRACT,
  topics: [
    SWAP_TOPIC,  // "swap"
  ],
  data: `${ADDRESS_TOKEN_A}${ADDRESS_TOKEN_B}${AMOUNT_100}${AMOUNT_250}${ADDRESS_TO}`,
  ledger: 55_000_001,
  timestamp: Math.floor(Date.now() / 1000) - 30,
  txHash: "b1c2d3e4f5a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3",
};

const MOCK_ADD_LIQUIDITY_EVENT: RawEvent = {
  id: "0000100-1",
  contractId: SOROSWAP_DEMO_CONTRACT,
  topics: [
    ADD_TOPIC,  // "add"
  ],
  data: `${ADDRESS_TOKEN_A}${ADDRESS_TOKEN_B}${ADDRESS_PAIR}${AMOUNT_100}${AMOUNT_250}${AMOUNT_100}${ADDRESS_TO}`,
  ledger: 55_000_002,
  timestamp: Math.floor(Date.now() / 1000) - 90,
  txHash: "c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
};

const MOCK_REMOVE_LIQUIDITY_EVENT: RawEvent = {
  id: "0000100-2",
  contractId: SOROSWAP_DEMO_CONTRACT,
  topics: [
    REMOVE_TOPIC,  // "remove"
  ],
  data: `${ADDRESS_TOKEN_A}${ADDRESS_TOKEN_B}${ADDRESS_PAIR}${AMOUNT_100}${AMOUNT_250}${AMOUNT_100}${ADDRESS_TO}`,
  ledger: 55_000_003,
  timestamp: Math.floor(Date.now() / 1000) - 180,
  txHash: "d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5",
};

// ─── swap ─────────────────────────────────────────────────────────────────────

describe("Soroswap Router blueprint — swap", () => {
  it("translates a swap event to plain English", () => {
    const result = translateEvent(MOCK_SWAP_EVENT);

    expect(result.status).toBe("translated");
    expect(result.eventType).toBe("Swap");
    expect(result.blueprintName).toContain("Soroswap");
    expect(result.description).toContain("Swap executed");
  });

  it("includes the recipient address in the description", () => {
    const result = translateEvent(MOCK_SWAP_EVENT);

    expect(result.description).toMatch(/\[.+\.\.\..+\]/);
  });

  it("translates swap to Spanish", () => {
    const result = translateEvent(MOCK_SWAP_EVENT, undefined, "es");

    expect(result.status).toBe("translated");
    expect(result.eventType).toBe("Swap");
    expect(result.description).toContain("Swap ejecutado");
  });

  it("translates swap to French", () => {
    const result = translateEvent(MOCK_SWAP_EVENT, undefined, "fr");

    expect(result.status).toBe("translated");
    expect(result.eventType).toBe("Swap");
    expect(result.description).toContain("Swap exécuté");
  });

  it("translates swap to Chinese", () => {
    const result = translateEvent(MOCK_SWAP_EVENT, undefined, "zh");

    expect(result.status).toBe("translated");
    expect(result.eventType).toBe("Swap");
    expect(result.description).toContain("Swap 已执行");
  });
});

// ─── add_liquidity ────────────────────────────────────────────────────────────

describe("Soroswap Router blueprint — add_liquidity", () => {
  it("translates an add_liquidity event to plain English", () => {
    const result = translateEvent(MOCK_ADD_LIQUIDITY_EVENT);

    expect(result.status).toBe("translated");
    expect(result.eventType).toBe("Add Liquidity");
    expect(result.blueprintName).toContain("Soroswap");
    expect(result.description).toContain("Added liquidity");
  });

  it("includes token addresses and amounts in the description", () => {
    const result = translateEvent(MOCK_ADD_LIQUIDITY_EVENT);

    expect(result.description).toMatch(/\[.+\.\.\..+\]/);
    expect(result.description).toContain("LP tokens");
  });

  it("translates add_liquidity to Spanish", () => {
    const result = translateEvent(MOCK_ADD_LIQUIDITY_EVENT, undefined, "es");

    expect(result.status).toBe("translated");
    expect(result.eventType).toBe("Añadir Liquidez");
    expect(result.description).toContain("Liquidez añadida");
  });

  it("translates add_liquidity to French", () => {
    const result = translateEvent(MOCK_ADD_LIQUIDITY_EVENT, undefined, "fr");

    expect(result.status).toBe("translated");
    expect(result.eventType).toBe("Ajout de Liquidité");
    expect(result.description).toContain("Ajout de liquidité");
  });

  it("translates add_liquidity to Chinese", () => {
    const result = translateEvent(MOCK_ADD_LIQUIDITY_EVENT, undefined, "zh");

    expect(result.status).toBe("translated");
    expect(result.eventType).toBe("添加流动性");
    expect(result.description).toContain("添加流动性");
  });
});

// ─── remove_liquidity ─────────────────────────────────────────────────────────

describe("Soroswap Router blueprint — remove_liquidity", () => {
  it("translates a remove_liquidity event to plain English", () => {
    const result = translateEvent(MOCK_REMOVE_LIQUIDITY_EVENT);

    expect(result.status).toBe("translated");
    expect(result.eventType).toBe("Remove Liquidity");
    expect(result.blueprintName).toContain("Soroswap");
    expect(result.description).toContain("Removed liquidity");
  });

  it("includes token addresses and amounts in the description", () => {
    const result = translateEvent(MOCK_REMOVE_LIQUIDITY_EVENT);

    expect(result.description).toMatch(/\[.+\.\.\..+\]/);
    expect(result.description).toContain("LP tokens");
  });

  it("translates remove_liquidity to Spanish", () => {
    const result = translateEvent(MOCK_REMOVE_LIQUIDITY_EVENT, undefined, "es");

    expect(result.status).toBe("translated");
    expect(result.eventType).toBe("Retirar Liquidez");
    expect(result.description).toContain("Liquidez retirada");
  });

  it("translates remove_liquidity to French", () => {
    const result = translateEvent(MOCK_REMOVE_LIQUIDITY_EVENT, undefined, "fr");

    expect(result.status).toBe("translated");
    expect(result.eventType).toBe("Retrait de Liquidité");
    expect(result.description).toContain("Retrait de liquidité");
  });

  it("translates remove_liquidity to Chinese", () => {
    const result = translateEvent(MOCK_REMOVE_LIQUIDITY_EVENT, undefined, "zh");

    expect(result.status).toBe("translated");
    expect(result.eventType).toBe("移除流动性");
    expect(result.description).toContain("移除流动性");
  });
});

// ─── Edge cases and rejection ─────────────────────────────────────────────────

describe("Soroswap Router blueprint — edge cases", () => {
  it("returns cryptic for an event with an unrecognised topic from a Soroswap contract", () => {
    const unknownEvent: RawEvent = {
      ...MOCK_SWAP_EVENT,
      topics: ["0xdeadbeefdeadbeef00000000000000000000000000000000000000000000beef"],
    };
    const result = translateEvent(unknownEvent);

    expect(result.status).toBe("cryptic");
  });

  it("returns cryptic for a completely empty topics array", () => {
    const emptyTopicsEvent: RawEvent = {
      ...MOCK_SWAP_EVENT,
      topics: [],
    };
    const result = translateEvent(emptyTopicsEvent);

    expect(result.status).toBe("cryptic");
  });

  it("does not translate events from contracts not registered as Soroswap", () => {
    const foreignContractEvent: RawEvent = {
      ...MOCK_SWAP_EVENT,
      contractId: "CFOREIGN000000000000000000000000000000000000000000000000000",
    };
    const result = translateEvent(foreignContractEvent);

    expect(result.status).toBe("cryptic");
    expect(result.blueprintName).toContain("Unregistered");
  });
});

// ─── Blueprint factory ────────────────────────────────────────────────────────

describe("createSoroswapRouterBlueprint", () => {
  it("creates a blueprint with the correct contract ID and name", () => {
    const blueprint = createSoroswapRouterBlueprint(SOROSWAP_MAINNET_CONTRACT);

    expect(blueprint.contractId).toBe(SOROSWAP_MAINNET_CONTRACT);
    expect(blueprint.contractName).toContain("Soroswap");
  });

  it("blueprint.translate() returns null for non-Soroswap events", () => {
    const blueprint = createSoroswapRouterBlueprint(SOROSWAP_MAINNET_CONTRACT);
    const sacTransferEvent: RawEvent = {
      id: "test-0",
      contractId: SOROSWAP_MAINNET_CONTRACT,
      topics: [
        "0x0000000000000000000000000000000000000000000000000000000074726e73", // "transfer"
        ADDRESS_TOKEN_A,
        ADDRESS_TOKEN_B,
      ],
      data: AMOUNT_100,
      ledger: 50_000_000,
      timestamp: Math.floor(Date.now() / 1000),
      txHash: "aaaa",
    };

    const result = blueprint.translate(sacTransferEvent, "en");

    expect(result).toBeNull();
  });

  it("blueprint.translate() returns a result for each Soroswap event type", () => {
    const blueprint = createSoroswapRouterBlueprint(SOROSWAP_DEMO_CONTRACT);

    expect(blueprint.translate(MOCK_SWAP_EVENT, "en")).not.toBeNull();
    expect(blueprint.translate(MOCK_ADD_LIQUIDITY_EVENT, "en")).not.toBeNull();
    expect(blueprint.translate(MOCK_REMOVE_LIQUIDITY_EVENT, "en")).not.toBeNull();
  });

  it("blueprint.matches() rejects events from unrelated contracts", () => {
    const blueprint = createSoroswapRouterBlueprint(SOROSWAP_MAINNET_CONTRACT);
    const foreignEvent: RawEvent = {
      ...MOCK_SWAP_EVENT,
      contractId: "CFOREIGN000000000000000000000000000000000000000000000000000",
    };

    expect(blueprint.matches?.(foreignEvent)).toBe(false);
  });

  it("blueprint.matches() accepts Soroswap events with known topics", () => {
    const blueprint = createSoroswapRouterBlueprint(SOROSWAP_DEMO_CONTRACT);

    expect(blueprint.matches?.(MOCK_SWAP_EVENT)).toBe(true);
    expect(blueprint.matches?.(MOCK_ADD_LIQUIDITY_EVENT)).toBe(true);
    expect(blueprint.matches?.(MOCK_REMOVE_LIQUIDITY_EVENT)).toBe(true);
  });

  it("SOROSWAP_CONTRACT_IDS exports the mainnet contract ID", () => {
    expect(SOROSWAP_CONTRACT_IDS).toContain(SOROSWAP_MAINNET_CONTRACT);
    expect(SOROSWAP_CONTRACT_IDS.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── Multi-language consistency ───────────────────────────────────────────────

describe("Soroswap Router blueprint — multi-language consistency", () => {
  const languages = ["en", "es", "fr", "zh"] as const;
  const events = [
    { name: "swap", event: MOCK_SWAP_EVENT },
    { name: "add_liquidity", event: MOCK_ADD_LIQUIDITY_EVENT },
    { name: "remove_liquidity", event: MOCK_REMOVE_LIQUIDITY_EVENT },
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
