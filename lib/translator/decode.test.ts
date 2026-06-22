import { describe, it, expect } from "vitest";
import { translateEvent, matchesEventCriteria } from "./registry";
import * as Core from "./core";
import type { RawEvent } from "./types";

const { interpolateTemplate, isValidHex, sanitizeHex, escapeHtml, detectScValType, decodeMap, decodeVec, decodeEnum, decodeScVal } = Core;

/**
 * Mock XDR data for testing Soroban event translation.
 * These represent standard SAC (Stellar Asset Contract) events:
 * 1. Transfer - tokens moved between accounts
 * 2. Mint - new tokens created
 * 3. Burn - tokens destroyed
 *
 * In production, these would come from Horizon/RPC endpoints.
 */
const MOCK_SAC_TRANSFER_EVENT: RawEvent = {
  id: "0000001-0",
  contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
  topics: [
    "0x0000000000000000000000000000000000000000000000000000000074726e73", // "transfer"
    // Address ScVal: SCV_ADDRESS (type=18) + SC_ADDRESS_TYPE_ACCOUNT (type=0) + 32-byte ed25519 pubkey
    "0x00000012000000000000000085a825af25ab38c944150cc569311cf76c80b8b521297c049c5c53204cd43e38",
    "0x000000120000000000000000fa6798a578d9f9f012f70a00cae3d6b15a7ada4518f98ad68c0cab21d16a0f5d",
  ],
  data: "0x00000000000000000000000000000000000000000005F5E100", // 100 USDC
  ledger: 52_341_001,
  timestamp: Math.floor(Date.now() / 1000) - 45,
  txHash: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
};

const MOCK_SAC_MINT_EVENT: RawEvent = {
  id: "0000001-3",
  contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
  topics: [
    "0x000000000000000000000000000000000000000000000000000000006d696e74", // "mint"
    // Address ScVal: SCV_ADDRESS (type=18) + SC_ADDRESS_TYPE_ACCOUNT (type=0) + 32-byte ed25519 pubkey
    "0x00000012000000000000000046b154e5ed3790ed2ff68484460559e6502361ff3ac0d0197e98edf3700731d4",
    "0x000000120000000000000000c16847681b580e9fe1ee7d4c99496f6aa20bd5bf02712ccc338813bdb21559b9",
  ],
  data: "0x0000000000000000000000000000000000000000017D7840", // 250 USDC
  ledger: 52_341_004,
  timestamp: Math.floor(Date.now() / 1000) - 310,
  txHash: "d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5",
};

const MOCK_SAC_BURN_EVENT: RawEvent = {
  id: "0000001-5",
  contractId: "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  topics: [
    "0x000000000000000000000000000000000000000000000000000000006275726e", // "burn"
    // Address ScVal: SCV_ADDRESS (type=18) + SC_ADDRESS_TYPE_ACCOUNT (type=0) + 32-byte ed25519 pubkey
    "0x0000001200000000000000005c0e8833db222000465cc32bdf60ed355e6408d12e65e7c988bd25fa4aee6ddd",
  ],
  data: "0x00000000000000000000000000000000000000000017D784", // 25 XLM
  ledger: 52_341_006,
  timestamp: Math.floor(Date.now() / 1000) - 600,
  txHash: "f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1",
};

describe("interpolateTemplate", () => {
  it("replaces all known placeholders", () => {
    const result = interpolateTemplate("User {from} sent {amount} tokens to {to}.", {
      from: "GABC...1234",
      amount: "100.00",
      to: "GXYZ...5678",
    });
    expect(result).toBe("User GABC...1234 sent 100.00 tokens to GXYZ...5678.");
  });

  it("leaves unknown placeholders intact", () => {
    const result = interpolateTemplate("Hello {name}, your balance is {amount}.", {
      amount: "50.00",
    });
    expect(result).toBe("Hello {name}, your balance is 50.00.");
  });

  it("returns the template unchanged when params is empty", () => {
    const template = "No {vars} here {really}.";
    expect(interpolateTemplate(template, {})).toBe(template);
  });

  it("replaces the same placeholder multiple times", () => {
    const result = interpolateTemplate("{a} and {a}", { a: "X" });
    expect(result).toBe("X and X");
  });
});

describe("translateEvent", () => {
  it("translates a SAC transfer event to plain English", () => {
    const result = translateEvent(MOCK_SAC_TRANSFER_EVENT);

    expect(result.status).toBe("translated");
    expect(result.description).toContain("transferred");
    expect(result.description).toContain("USDC");
    expect(result.description).toContain("to [");
    expect(result.eventType).toBe("Transfer");
    expect(result.blueprintName).toContain("Stellar Asset Contract");
  });

  it("translates a SAC mint event to plain English", () => {
    const result = translateEvent(MOCK_SAC_MINT_EVENT);

    expect(result.status).toBe("translated");
    expect(result.description).toContain("minted");
    expect(result.description).toContain("USDC");
    expect(result.description).toContain("to [");
    expect(result.eventType).toBe("Mint");
    expect(result.blueprintName).toContain("Stellar Asset Contract");
  });

  it("translates a SAC burn event to plain English", () => {
    const result = translateEvent(MOCK_SAC_BURN_EVENT);

    expect(result.status).toBe("translated");
    expect(result.description).toContain("burned");
    expect(result.description).toContain("XLM");
    expect(result.eventType).toBe("Burn");
    expect(result.blueprintName).toContain("Stellar Asset Contract");
  });

  it("uses multi-topic blueprint criteria before translating", () => {
    const statusTopic =
      "0x000000000000000000000000000000000000000000000000000000006f70656e";
    const closedStatusTopic =
      "0x00000000000000000000000000000000000000000000000000000000636c6f736564";
    const contractId = "CMULTITOPIC0000000000000000000000000000000000000000000";
    const event: RawEvent = {
      id: "0000002-0",
      contractId,
      topics: [
        "0x00000000000000000000000000000000000000000000000000000000737461747573",
        "0x01",
        statusTopic,
        "0x03",
      ],
      data: "0x00",
      ledger: 52_341_007,
      timestamp: Math.floor(Date.now() / 1000),
      txHash: "abcd",
    };
    const blueprint: TranslationBlueprint = {
      contractId,
      contractName: "Multi Topic Contract",
      matches: function (rawEvent) {
        return matchesEventCriteria(rawEvent, {
          contractId,
          topics: [
            { index: 0, includes: "737461747573" },
            { index: 2, equals: statusTopic },
          ],
        });
      },
      translate: function () {
        return {
          description: "Status is open",
          eventType: "Status",
        };
      },
    };
    const customBlueprints = new Map([[contractId, blueprint]]);

    expect(translateEvent(event, customBlueprints).status).toBe("translated");

    const nonMatching = {
      ...event,
      topics: [event.topics[0], event.topics[1], closedStatusTopic, event.topics[3]],
    };
    expect(translateEvent(nonMatching, customBlueprints).status).toBe("cryptic");
  });
});

describe("Hex sanitization", () => {
  it("validates correct hex strings", () => {
    expect(isValidHex("0x123abc")).toBe(true);
    expect(isValidHex("123abc")).toBe(true);
    expect(isValidHex("ABCDEF")).toBe(true);
  });

  it("rejects invalid hex strings", () => {
    expect(isValidHex("0x123xyz")).toBe(false);
    expect(isValidHex("")).toBe(false);
    expect(isValidHex("not hex")).toBe(false);
    expect(isValidHex(null as unknown as string)).toBe(false);
  });

  it("sanitizes hex strings by removing non-hex characters", () => {
    expect(sanitizeHex("0x123abc")).toBe("0x123abc");
    expect(sanitizeHex("0x12-3ab-c")).toBe("0x123abc");
    expect(sanitizeHex("123xyz")).toBe("0x123");
    expect(sanitizeHex("")).toBe("");
  });

  it("escapes HTML entities to prevent XSS", () => {
    expect(escapeHtml("<script>alert('xss')</script>")).toBe("&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;");
    expect(escapeHtml("test&value")).toBe("test&amp;value");
    expect(escapeHtml('quote"test')).toBe("quote&quot;test");
  });
});

describe("String and text validation & sanitization", () => {
  it("sanitizes malicious payload strings by escaping HTML", () => {
    const malicious = "<img src=x onerror=alert(1)> <script>eval('bad')</script>";
    const sanitized = sanitizeTextField(malicious);
    expect(sanitized).not.toContain("<img");
    expect(sanitized).not.toContain("<script>");
    expect(sanitized).toBe("&lt;img src=x onerror=alert(1)&gt; &lt;script&gt;eval(&#39;bad&#39;)&lt;/script&gt;");
  });

  it("truncates extremely long text fields to avoid UI layout breakages", () => {
    const longText = "a".repeat(300);
    const sanitized = sanitizeTextField(longText, { maxLength: 50 });
    expect(sanitized.length).toBe(50);
    expect(sanitized).toBe("a".repeat(50));
  });

  it("removes control characters and non-printable characters", () => {
    const controlText = "Hello\u0000World\u001f!";
    expect(sanitizeTextField(controlText)).toBe("HelloWorld!");
  });

  it("validates text fields against alphanumeric constraints", () => {
    expect(validateTextField("ValidProjectName123")).toBe(true);
    expect(validateTextField("Valid Project-Name (1)")).toBe(true);
    expect(validateTextField("Bad<script>")).toBe(false);
    expect(validateTextField("a".repeat(300))).toBe(false);
  });
});

describe("Complex ScVal type decoding", () => {
  describe("detectScValType", () => {
    it("detects Vec type from hex", () => {
      expect(detectScValType("0x00000010")).toBe("Vec");
    });

    it("detects Map type from hex", () => {
      expect(detectScValType("0x00000011")).toBe("Map");
    });

    it("detects Address type from 32-byte hex", () => {
      const addressHex = "a".repeat(64);
      expect(detectScValType(`0x${addressHex}`)).toBe("Address");
    });

    it("detects String type from hex", () => {
      expect(detectScValType("0x0000000e")).toBe("String");
      expect(detectScValType("0x0000000f")).toBe("String");
    });

    it("defaults to Bytes for unknown types", () => {
      expect(detectScValType("0x12345678")).toBe("Bytes");
    });

    it("handles invalid hex", () => {
      expect(detectScValType("invalid")).toBe("Void");
    });
  });

  describe("decodeMap", () => {
    it("decodes a map from hex", () => {
      const mapHex = "0x00000011" + "a".repeat(64);
      const result = decodeMap(mapHex);

      expect(result.type).toBe("Map");
      expect(result.entries).toBeDefined();
      expect(result.summary).toContain("Map");
    });

    it("handles invalid map data", () => {
      const result = decodeMap("invalid");

      expect(result.type).toBe("Map");
      expect(result.entries).toEqual([]);
      expect(result.summary).toBe("Invalid map data");
    });

    it("handles empty map data", () => {
      const result = decodeMap("");

      expect(result.type).toBe("Map");
      expect(result.entries).toEqual([]);
    });
  });

  describe("decodeVec", () => {
    it("decodes a vector from hex", () => {
      const vecHex = "0x00000010" + "b".repeat(64);
      const result = decodeVec(vecHex);

      expect(result.type).toBe("Vec");
      expect(result.elements).toBeDefined();
      expect(result.summary).toContain("Vec");
    });

    it("handles invalid vector data", () => {
      const result = decodeVec("invalid");

      expect(result.type).toBe("Vec");
      expect(result.elements).toEqual([]);
      expect(result.summary).toBe("Invalid vector data");
    });

    it("handles empty vector data", () => {
      const result = decodeVec("");

      expect(result.type).toBe("Vec");
      expect(result.elements).toEqual([]);
    });
  });

  describe("decodeEnum", () => {
    it("decodes an enum from hex", () => {
      const enumHex = "0x00000003" + "c".repeat(32);
      const result = decodeEnum(enumHex);

      expect(result.type).toBe("Enum");
      expect(result.variant).toBeDefined();
      expect(result.summary).toContain("Enum");
    });

    it("decodes enum with known variants", () => {
      const knownVariants = {
        "00000003": "CustomVariant",
      };
      const enumHex = "0x00000003" + "d".repeat(32);
      const result = decodeEnum(enumHex, knownVariants);

      expect(result.variant).toBe("CustomVariant");
    });

    it("decodes enum with payload", () => {
      const enumHex = "0x00000001" + "e".repeat(32);
      const result = decodeEnum(enumHex);

      expect(result.type).toBe("Enum");
      expect(result.value).toBeDefined();
      expect(result.summary).toContain("(");
    });

    it("handles invalid enum data", () => {
      const result = decodeEnum("invalid");

      expect(result.type).toBe("Enum");
      expect(result.variant).toBe("unknown");
      expect(result.summary).toBe("Invalid enum data");
    });
  });

  describe("decodeScVal", () => {
    it("dispatches to map decoder for Map type", () => {
      const mapHex = "0x00000011" + "f".repeat(64);
      const result = decodeScVal(mapHex);

      expect(result.type).toBe("Map");
    });

    it("dispatches to vector decoder for Vec type", () => {
      const vecHex = "0x00000010" + "0".repeat(64);
      const result = decodeScVal(vecHex);

      expect(result.type).toBe("Vec");
    });

    it("handles Address type", () => {
      const addressHex = "0x" + "1".repeat(64);
      const result = decodeScVal(addressHex);

      expect(result.type).toBe("Address");
      if (result.type === "Address" || result.type === "U128" || result.type === "Void") {
        expect(result.value).toBeDefined();
      }
    });

    it("handles U128 type", () => {
      const u128Hex = "0x" + "2".repeat(32);
      const result = decodeScVal(u128Hex);

      expect(result.type).toBe("U128");
      if (result.type === "Address" || result.type === "U128" || result.type === "Void") {
        expect(result.value).toBeDefined();
      }
    });

    it("handles invalid hex", () => {
      const result = decodeScVal("invalid");

      expect(result.type).toBe("Void");
      if (result.type === "Address" || result.type === "U128" || result.type === "Void") {
        expect(result.value).toBe("invalid");
      }
    });
  });
});
