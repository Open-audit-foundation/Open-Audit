import { describe, expect, it } from "vitest";
import { eventResponseToRawEvent, normalizeTopics } from "./events";
import type { SorobanRpc } from "stellar-sdk";

function scVal(hex: string): { toXDR: (encoding: "hex" | "base64") => string } {
  return {
    toXDR: function (encoding: "hex" | "base64"): string {
      return encoding === "hex" ? hex : Buffer.from(hex, "hex").toString("base64");
    },
  };
}

describe("eventResponseToRawEvent", () => {
  it("maps the full Soroban topic vector in order", () => {
    const event = {
      id: "000001-000000",
      contractId: "CCONTRACT",
      ledger: 123,
      ledgerClosedAt: "2026-06-19T12:00:00Z",
      topic: [
        "0x7369676e6174757265",
        "0x6669727374",
        "0x737461747573",
        "0x666f75727468",
      ],
      value: "0x64617461",
      txHash: "hash",
    } as unknown as SorobanRpc.Api.EventResponse;

    const raw = eventResponseToRawEvent(event);

    expect(raw.topics).toEqual([
      "0x7369676e6174757265",
      "0x6669727374",
      "0x737461747573",
      "0x666f75727468",
    ]);
    expect(raw.data).toBe("0x64617461");
    expect(raw.timestamp).toBe(1_781_870_400);
  });
});

describe("normalizeTopics", () => {
  it("normalizes SDK ScVal-like topic objects to hex without dropping positions", () => {
    expect(normalizeTopics([scVal("01"), scVal("02"), scVal("03")])).toEqual([
      "0x01",
      "0x02",
      "0x03",
    ]);
  });
});
