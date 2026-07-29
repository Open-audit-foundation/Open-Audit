/**
 * Test suite for the Soroswap Router translation blueprint.
 *
 * Fixtures are built with the real stellar-sdk XDR encoders (the same
 * approach used in decode-map-vec.test.ts and decode-amount.test.ts) rather
 * than hand-typed hex, since Soroswap Router events carry a struct-typed
 * (Map-encoded) data payload that would be error-prone to hand-encode.
 */

import { describe, it, expect } from "vitest";
import { xdr as StellarXdr } from "stellar-sdk";
import { translateEvent } from "../registry";
import {
  createSoroswapRouterBlueprint,
  SOROSWAP_ROUTER_CONTRACT_IDS,
} from "../blueprints/soroswap-router";
import type { RawEvent } from "../types";

// ─── XDR fixture helpers ───────────────────────────────────────────────────────

function symbolHex(name: string): string {
  return "0x" + StellarXdr.ScVal.scvSymbol(Buffer.from(name)).toXDR("hex");
}

function contractAddressHex(fillByte: number): string {
  const scAddress = StellarXdr.ScAddress.scAddressTypeContract(Buffer.alloc(32, fillByte));
  return "0x" + StellarXdr.ScVal.scvAddress(scAddress).toXDR("hex");
}

function addressScVal(fillByte: number): StellarXdr.ScVal {
  const scAddress = StellarXdr.ScAddress.scAddressTypeContract(Buffer.alloc(32, fillByte));
  return StellarXdr.ScVal.scvAddress(scAddress);
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

function mapHex(entries: Array<{ key: StellarXdr.ScVal; val: StellarXdr.ScVal }>): string {
  const scMap = StellarXdr.ScVal.scvMap(
    entries.map(({ key, val }) => new StellarXdr.ScMapEntry({ key, val }))
  );
  return "0x" + scMap.toXDR("hex");
}

function sym(name: string): StellarXdr.ScVal {
  return StellarXdr.ScVal.scvSymbol(Buffer.from(name));
}

// ─── Contract IDs ─────────────────────────────────────────────────────────────

const ROUTER_MAINNET_CONTRACT = "CAG5LRYQ5JVEUI5TEID72EYOVX44TTUJT5BQR2J6J77FH65PCCFAJDDH";
const ROUTER_TESTNET_CONTRACT = "CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD";

// ─── Topic fixtures ─────────────────────────────────────────────────────────────

const ROUTER_TAG_TOPIC = symbolHex("SoroswapRouter");
const SWAP_TOPIC = symbolHex("swap");
const ADD_TOPIC = symbolHex("add");
const REMOVE_TOPIC = symbolHex("remove");

// ─── Event fixtures ─────────────────────────────────────────────────────────────

const MOCK_SWAP_EVENT: RawEvent = {
  id: "0000200-0",
  contractId: ROUTER_TESTNET_CONTRACT,
  topics: [ROUTER_TAG_TOPIC, SWAP_TOPIC],
  data: mapHex([
    { key: sym("path"), val: StellarXdr.ScVal.scvVec([addressScVal(1), addressScVal(2)]) },
    {
      key: sym("amounts"),
      val: StellarXdr.ScVal.scvVec([i128ScVal(1_000_000_000n), i128ScVal(1_950_000_000n)]),
    },
    { key: sym("to"), val: addressScVal(3) },
  ]),
  ledger: 60_000_001,
  timestamp: Math.floor(Date.now() / 1000) - 20,
  txHash: "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1",
};

const MOCK_ADD_LIQUIDITY_EVENT: RawEvent = {
  id: "0000200-1",
  contractId: ROUTER_TESTNET_CONTRACT,
  topics: [ROUTER_TAG_TOPIC, ADD_TOPIC],
  data: mapHex([
    { key: sym("token_a"), val: addressScVal(4) },
    { key: sym("token_b"), val: addressScVal(5) },
    { key: sym("pair"), val: addressScVal(6) },
    { key: sym("amount_a"), val: i128ScVal(500_000_000n) },
    { key: sym("amount_b"), val: i128ScVal(750_000_000n) },
    { key: sym("liquidity"), val: i128ScVal(600_000_000n) },
    { key: sym("to"), val: addressScVal(7) },
  ]),
  ledger: 60_000_002,
  timestamp: Math.floor(Date.now() / 1000) - 60,
  txHash: "b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2",
};

const MOCK_REMOVE_LIQUIDITY_EVENT: RawEvent = {
  id: "0000200-2",
  contractId: ROUTER_TESTNET_CONTRACT,
  topics: [ROUTER_TAG_TOPIC, REMOVE_TOPIC],
  data: mapHex([
    { key: sym("token_a"), val: addressScVal(4) },
    { key: sym("token_b"), val: addressScVal(5) },
    { key: sym("pair"), val: addressScVal(6) },
    { key: sym("amount_a"), val: i128ScVal(200_000_000n) },
    { key: sym("amount_b"), val: i128ScVal(300_000_000n) },
    { key: sym("liquidity"), val: i128ScVal(240_000_000n) },
    { key: sym("to"), val: addressScVal(7) },
  ]),
  ledger: 60_000_003,
  timestamp: Math.floor(Date.now() / 1000) - 90,
  txHash: "c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3",
};

// ─── swap ──────────────────────────────────────────────────────────────────────

describe("Soroswap Router blueprint — swap", () => {
  it("translates a swap event to plain English", () => {
    const result = translateEvent(MOCK_SWAP_EVENT);

    expect(result.status).toBe("translated");
    expect(result.eventType).toBe("Swap");
    expect(result.blueprintName).toBe("Soroswap Router");
    expect(result.description).toContain("swapped");
  });

  it("translates swap to Spanish", () => {
    const result = translateEvent(MOCK_SWAP_EVENT, undefined, "es");
    expect(result.status).toBe("translated");
    expect(result.eventType).toBe("Intercambio");
    expect(result.description).toContain("intercambió");
  });

  it("translates swap to French", () => {
    const result = translateEvent(MOCK_SWAP_EVENT, undefined, "fr");
    expect(result.status).toBe("translated");
    expect(result.eventType).toBe("Échange");
    expect(result.description).toContain("échangé");
  });

  it("translates swap to Chinese", () => {
    const result = translateEvent(MOCK_SWAP_EVENT, undefined, "zh");
    expect(result.status).toBe("translated");
    expect(result.eventType).toBe("兑换");
    expect(result.description).toContain("兑换");
  });
});

// ─── add liquidity ───────────────────────────────────────────────────────────────

describe("Soroswap Router blueprint — add liquidity", () => {
  it("translates an add_liquidity event to plain English", () => {
    const result = translateEvent(MOCK_ADD_LIQUIDITY_EVENT);

    expect(result.status).toBe("translated");
    expect(result.eventType).toBe("Add Liquidity");
    expect(result.blueprintName).toBe("Soroswap Router");
    expect(result.description).toContain("added");
    expect(result.description).toContain("50.00");
  });

  it("translates add_liquidity to Spanish", () => {
    const result = translateEvent(MOCK_ADD_LIQUIDITY_EVENT, undefined, "es");
    expect(result.status).toBe("translated");
    expect(result.eventType).toBe("Agregar Liquidez");
    expect(result.description).toContain("agregó");
  });

  it("translates add_liquidity to French", () => {
    const result = translateEvent(MOCK_ADD_LIQUIDITY_EVENT, undefined, "fr");
    expect(result.status).toBe("translated");
    expect(result.eventType).toBe("Ajout de Liquidité");
    expect(result.description).toContain("ajouté");
  });

  it("translates add_liquidity to Chinese", () => {
    const result = translateEvent(MOCK_ADD_LIQUIDITY_EVENT, undefined, "zh");
    expect(result.status).toBe("translated");
    expect(result.eventType).toBe("添加流动性");
    expect(result.description).toContain("添加");
  });
});

// ─── remove liquidity ────────────────────────────────────────────────────────────

describe("Soroswap Router blueprint — remove liquidity", () => {
  it("translates a remove_liquidity event to plain English", () => {
    const result = translateEvent(MOCK_REMOVE_LIQUIDITY_EVENT);

    expect(result.status).toBe("translated");
    expect(result.eventType).toBe("Remove Liquidity");
    expect(result.blueprintName).toBe("Soroswap Router");
    expect(result.description).toContain("removed");
  });

  it("translates remove_liquidity to Spanish", () => {
    const result = translateEvent(MOCK_REMOVE_LIQUIDITY_EVENT, undefined, "es");
    expect(result.status).toBe("translated");
    expect(result.eventType).toBe("Retirar Liquidez");
    expect(result.description).toContain("retiró");
  });

  it("translates remove_liquidity to French", () => {
    const result = translateEvent(MOCK_REMOVE_LIQUIDITY_EVENT, undefined, "fr");
    expect(result.status).toBe("translated");
    expect(result.eventType).toBe("Retrait de Liquidité");
    expect(result.description).toContain("retiré");
  });

  it("translates remove_liquidity to Chinese", () => {
    const result = translateEvent(MOCK_REMOVE_LIQUIDITY_EVENT, undefined, "zh");
    expect(result.status).toBe("translated");
    expect(result.eventType).toBe("移除流动性");
    expect(result.description).toContain("移除");
  });
});

// ─── Edge cases and rejection ─────────────────────────────────────────────────

describe("Soroswap Router blueprint — edge cases", () => {
  it("returns null for an unknown event name under the router tag", () => {
    const blueprint = createSoroswapRouterBlueprint(ROUTER_MAINNET_CONTRACT);
    const unknownEvent: RawEvent = {
      ...MOCK_SWAP_EVENT,
      topics: [ROUTER_TAG_TOPIC, symbolHex("initialize")],
    };

    expect(blueprint.translate(unknownEvent, "en")).toBeNull();
  });

  it("returns null for events not tagged with the SoroswapRouter symbol", () => {
    const blueprint = createSoroswapRouterBlueprint(ROUTER_MAINNET_CONTRACT);
    const foreignEvent: RawEvent = {
      ...MOCK_SWAP_EVENT,
      topics: [symbolHex("transfer"), SWAP_TOPIC],
    };

    expect(blueprint.translate(foreignEvent, "en")).toBeNull();
  });

  it("returns null for an empty topics array without throwing", () => {
    const blueprint = createSoroswapRouterBlueprint(ROUTER_MAINNET_CONTRACT);
    const emptyTopicsEvent: RawEvent = { ...MOCK_SWAP_EVENT, topics: [] };

    expect(() => blueprint.translate(emptyTopicsEvent, "en")).not.toThrow();
    expect(blueprint.translate(emptyTopicsEvent, "en")).toBeNull();
  });

  it("does not translate events from contracts not registered as Soroswap Router", () => {
    const foreignContractEvent: RawEvent = {
      ...MOCK_SWAP_EVENT,
      contractId: "CFOREIGN000000000000000000000000000000000000000000000000000",
    };
    const result = translateEvent(foreignContractEvent);

    expect(result.status).toBe("cryptic");
    expect(result.blueprintName).toContain("Unregistered");
  });
});

// ─── Blueprint factory & matches() ─────────────────────────────────────────────

describe("createSoroswapRouterBlueprint", () => {
  it("creates a blueprint with the correct contract ID and name", () => {
    const blueprint = createSoroswapRouterBlueprint(ROUTER_MAINNET_CONTRACT);

    expect(blueprint.contractId).toBe(ROUTER_MAINNET_CONTRACT);
    expect(blueprint.contractName).toBe("Soroswap Router");
  });

  it("blueprint.translate() returns a result for each Soroswap event type", () => {
    const blueprint = createSoroswapRouterBlueprint(ROUTER_TESTNET_CONTRACT);

    expect(blueprint.translate(MOCK_SWAP_EVENT, "en")).not.toBeNull();
    expect(blueprint.translate(MOCK_ADD_LIQUIDITY_EVENT, "en")).not.toBeNull();
    expect(blueprint.translate(MOCK_REMOVE_LIQUIDITY_EVENT, "en")).not.toBeNull();
  });

  it("matches() accepts events from its own contract ID", () => {
    const blueprint = createSoroswapRouterBlueprint(ROUTER_TESTNET_CONTRACT);
    expect(blueprint.matches?.(MOCK_SWAP_EVENT)).toBe(true);
  });

  it("matches() rejects events from unrelated contracts", () => {
    const blueprint = createSoroswapRouterBlueprint(ROUTER_TESTNET_CONTRACT);
    const unrelatedEvent: RawEvent = {
      ...MOCK_SWAP_EVENT,
      contractId: "CUNRELATED00000000000000000000000000000000000000000000",
    };

    expect(blueprint.matches?.(unrelatedEvent)).toBe(false);
  });

  it("SOROSWAP_ROUTER_CONTRACT_IDS exports both canonical contract IDs", () => {
    expect(SOROSWAP_ROUTER_CONTRACT_IDS).toContain(ROUTER_MAINNET_CONTRACT);
    expect(SOROSWAP_ROUTER_CONTRACT_IDS).toContain(ROUTER_TESTNET_CONTRACT);
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
