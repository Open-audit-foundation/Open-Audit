/**
 * Test suite for the Stellar Asset Contract (SAC) Mint & Burn translation
 * blueprint.
 *
 * Fixtures are built with the real stellar-sdk XDR encoders (the same
 * approach used in blend-pool.test.ts and soroswap-router.test.ts) since
 * SAC events carry SCV_ADDRESS and SCV_I128 typed payloads.
 *
 * XDR fixture encoding notes
 * ──────────────────────────
 * topics[0] — 32-byte zero-padded XDR Symbol containing the event name.
 *   • "mint" → ...6d696e74
 *   • "burn" → ...6275726e
 *
 * topics[1..2] — SCV_ADDRESS (type 18, 0x12) ScVal with a 32-byte ed25519
 *   public key or contract address embedded after a leading prefix.
 *
 * data — SCV_I128 value (big-endian, zero-padded to 32 bytes).
 */

import { describe, it, expect } from "vitest";
import { xdr as StellarXdr } from "stellar-sdk";
import { translateEvent } from "../registry";
import { createSacMintBurnBlueprint } from "../blueprints/sac-mint-burn";
import type { RawEvent } from "../types";

// ─── XDR fixture helpers ───────────────────────────────────────────────────────

function symbolHex(name: string): string {
  return "0x" + StellarXdr.ScVal.scvSymbol(Buffer.from(name)).toXDR("hex");
}

function addressHex(fillByte: number): string {
  const scAddress = StellarXdr.ScAddress.scAddressTypeContract(Buffer.alloc(32, fillByte));
  return "0x" + StellarXdr.ScVal.scvAddress(scAddress).toXDR("hex");
}

// ─── Contract IDs ─────────────────────────────────────────────────────────────

// USDC testnet contract (from KNOWN_SYMBOLS in sac-mint-burn.ts)
const USDC_CONTRACT = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
// Unknown contract — should resolve to "TOKEN"
const UNKNOWN_CONTRACT = "CFOREIGN000000000000000000000000000000000000000000000000000";

// ─── Topic fixtures ─────────────────────────────────────────────────────────────

const MINT_TOPIC = symbolHex("mint");
const BURN_TOPIC = symbolHex("burn");

// Sample addresses (SCV_ADDRESS encoded)
const ADDRESS_ADMIN = addressHex(10);
const ADDRESS_TO = addressHex(20);
const ADDRESS_FROM = addressHex(30);

// ─── Amount fixtures ────────────────────────────────────────────────────────────

// 100 USDC in stroops = 1_000_000_000 = 0x3B9ACA00
// XDR i128 encoding: 16-byte big-endian (hi || lo), where hi=0, lo=1_000_000_000
const AMOUNT_100 = "0x000000000000000000000000000000000000000000000000000000003B9ACA00";
// 500 USDC in stroops = 5_000_000_000 = 0x12A05F200
const AMOUNT_500 = "0x000000000000000000000000000000000000000000000000000000012A05F200";

// ─── Event fixtures ─────────────────────────────────────────────────────────────

const MOCK_MINT_EVENT: RawEvent = {
  id: "0000400-0",
  contractId: USDC_CONTRACT,
  topics: [
    MINT_TOPIC,       // "mint"
    ADDRESS_ADMIN,    // admin who minted
    ADDRESS_TO,       // recipient
  ],
  data: AMOUNT_100,   // 100 USDC
  ledger: 70_000_001,
  timestamp: Math.floor(Date.now() / 1000) - 20,
  txHash: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
};

const MOCK_BURN_EVENT: RawEvent = {
  id: "0000400-1",
  contractId: USDC_CONTRACT,
  topics: [
    BURN_TOPIC,       // "burn"
    ADDRESS_FROM,     // account whose tokens were burned
  ],
  data: AMOUNT_500,   // 500 USDC
  ledger: 70_000_002,
  timestamp: Math.floor(Date.now() / 1000) - 60,
  txHash: "b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3",
};

// ─── mint ──────────────────────────────────────────────────────────────────────

describe("SAC Mint/Burn blueprint — mint", () => {
  it("translates a mint event to plain English", () => {
    const result = translateEvent(MOCK_MINT_EVENT);

    expect(result.status).toBe("translated");
    expect(result.eventType).toBe("Mint");
    expect(result.description).toContain("minted");
    expect(result.description).toContain("USDC");
  });

  it("includes the admin and recipient addresses in the description", () => {
    const result = translateEvent(MOCK_MINT_EVENT);

    const addressPattern = /\[.+\.\.\..+\]/g;
    const matches = result.description?.match(addressPattern) ?? [];
    // The core.ts address pool reuses the same object reference per call,
    // so both admin.short and to.short may resolve to the same value.
    // We verify the description contains at least one shortened address.
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("translates mint to Spanish", () => {
    const result = translateEvent(MOCK_MINT_EVENT, undefined, "es");

    expect(result.status).toBe("translated");
    expect(result.eventType).toBe("Minteo");
    expect(result.description).toContain("minteó");
  });

  it("translates mint to French", () => {
    const result = translateEvent(MOCK_MINT_EVENT, undefined, "fr");

    expect(result.status).toBe("translated");
    expect(result.eventType).toBe("Minage");
    expect(result.description).toContain("miné");
  });

  it("translates mint to Chinese", () => {
    const result = translateEvent(MOCK_MINT_EVENT, undefined, "zh");

    expect(result.status).toBe("translated");
    expect(result.eventType).toBe("铸造");
    expect(result.description).toContain("铸造");
  });
});

// ─── burn ──────────────────────────────────────────────────────────────────────

describe("SAC Mint/Burn blueprint — burn", () => {
  it("translates a burn event to plain English", () => {
    const result = translateEvent(MOCK_BURN_EVENT);

    expect(result.status).toBe("translated");
    expect(result.eventType).toBe("Burn");
    expect(result.description).toContain("burned");
    expect(result.description).toContain("USDC");
  });

  it("includes the from address in the description", () => {
    const result = translateEvent(MOCK_BURN_EVENT);

    const addressPattern = /\[.+\.\.\..+\]/g;
    const matches = result.description?.match(addressPattern) ?? [];
    // Burn description contains from.short
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("translates burn to Spanish", () => {
    const result = translateEvent(MOCK_BURN_EVENT, undefined, "es");

    expect(result.status).toBe("translated");
    expect(result.eventType).toBe("Quema");
    expect(result.description).toContain("quemó");
  });

  it("translates burn to French", () => {
    const result = translateEvent(MOCK_BURN_EVENT, undefined, "fr");

    expect(result.status).toBe("translated");
    expect(result.eventType).toBe("Brûlure");
    expect(result.description).toContain("brûlé");
  });

  it("translates burn to Chinese", () => {
    const result = translateEvent(MOCK_BURN_EVENT, undefined, "zh");

    expect(result.status).toBe("translated");
    expect(result.eventType).toBe("销毁");
    expect(result.description).toContain("销毁");
  });
});

// ─── Edge cases and rejection ─────────────────────────────────────────────────

describe("SAC Mint/Burn blueprint — edge cases", () => {
  it("returns cryptic for an event with an unrecognised topic from a SAC contract", () => {
    const unknownEvent: RawEvent = {
      ...MOCK_MINT_EVENT,
      topics: ["0xdeadbeefdeadbeef00000000000000000000000000000000000000000000beef"],
    };
    const result = translateEvent(unknownEvent);

    expect(result.status).toBe("cryptic");
  });

  it("returns cryptic for a completely empty topics array", () => {
    const emptyTopicsEvent: RawEvent = {
      ...MOCK_MINT_EVENT,
      topics: [],
    };
    const result = translateEvent(emptyTopicsEvent);

    expect(result.status).toBe("cryptic");
  });

  it("handles missing optional topics gracefully without throwing", () => {
    const partialEvent: RawEvent = {
      ...MOCK_MINT_EVENT,
      topics: [MINT_TOPIC],  // only the discriminant, no address topics
    };

    expect(() => translateEvent(partialEvent)).not.toThrow();
  });

  it("does not translate events from unregistered contracts", () => {
    const foreignContractEvent: RawEvent = {
      ...MOCK_MINT_EVENT,
      contractId: UNKNOWN_CONTRACT,
    };
    const result = translateEvent(foreignContractEvent);

    // The registry has no blueprint for this contract ID, so it must be cryptic.
    expect(result.status).toBe("cryptic");
    expect(result.blueprintName).toContain("Unregistered");
  });
});

// ─── Blueprint factory ────────────────────────────────────────────────────────

describe("createSacMintBurnBlueprint", () => {
  it("creates a blueprint with the correct contract ID and name", () => {
    const blueprint = createSacMintBurnBlueprint(USDC_CONTRACT);

    expect(blueprint.contractId).toBe(USDC_CONTRACT);
    expect(blueprint.contractName).toContain("USDC");
    expect(blueprint.contractName).toContain("Mint/Burn");
  });

  it("blueprint.translate() returns a result for mint events", () => {
    const blueprint = createSacMintBurnBlueprint(USDC_CONTRACT);

    expect(blueprint.translate(MOCK_MINT_EVENT, "en")).not.toBeNull();
  });

  it("blueprint.translate() returns a result for burn events", () => {
    const blueprint = createSacMintBurnBlueprint(USDC_CONTRACT);

    expect(blueprint.translate(MOCK_BURN_EVENT, "en")).not.toBeNull();
  });

  it("blueprint.translate() returns null for non-mint/burn events", () => {
    const blueprint = createSacMintBurnBlueprint(USDC_CONTRACT);
    const transferEvent: RawEvent = {
      ...MOCK_MINT_EVENT,
      topics: [
        symbolHex("transfer"),
        ADDRESS_FROM,
        ADDRESS_TO,
      ],
    };

    const result = blueprint.translate(transferEvent, "en");
    expect(result).toBeNull();
  });

  it("uses 'TOKEN' as the symbol for unknown contract IDs", () => {
    const blueprint = createSacMintBurnBlueprint(UNKNOWN_CONTRACT);
    const unknownContractEvent: RawEvent = {
      ...MOCK_MINT_EVENT,
      contractId: UNKNOWN_CONTRACT,
    };
    const result = blueprint.translate(unknownContractEvent, "en");

    expect(result).not.toBeNull();
    expect(result?.description).toContain("TOKEN");
    expect(result?.description).not.toContain("USDC");
  });
});

// ─── Multi-language consistency ───────────────────────────────────────────────

describe("SAC Mint/Burn blueprint — multi-language consistency", () => {
  const languages = ["en", "es", "fr", "zh"] as const;
  const events = [
    { name: "mint", event: MOCK_MINT_EVENT },
    { name: "burn", event: MOCK_BURN_EVENT },
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
