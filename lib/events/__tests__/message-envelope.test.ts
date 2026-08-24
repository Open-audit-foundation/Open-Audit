import { describe, expect, it } from "vitest";
import {
  createEventMessage,
  parseEventMessage,
  serializeEventMessage,
  toWebSocketPayload,
} from "../message-envelope";
import type { RawEvent, TranslatedEvent } from "../../translator/types";

const rawEvent: RawEvent = {
  id: "0000123456-0001",
  contractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  topics: ["0x00"],
  data: "0x01",
  ledger: 123456,
  timestamp: 1713456789,
  txHash: "abc123",
};

const translatedEvent: TranslatedEvent = {
  raw: rawEvent,
  status: "translated",
  description: "Transferred 100 tokens",
  blueprintName: "Stellar Asset Contract (SAC)",
  eventType: "Transfer",
};

describe("message-envelope", () => {
  it("round-trips event messages through Redis pub/sub format", () => {
    const envelope = createEventMessage("worker-test", rawEvent, translatedEvent);
    const parsed = parseEventMessage(serializeEventMessage(envelope));

    expect(parsed).not.toBeNull();
    expect(parsed?.workerId).toBe("worker-test");
    expect(parsed?.translated.description).toBe("Transferred 100 tokens");
  });

  it("extracts TranslatedEvent for WebSocket broadcast", () => {
    const envelope = createEventMessage("worker-test", rawEvent, translatedEvent);
    const payload = toWebSocketPayload(envelope);

    expect(payload.raw.id).toBe(rawEvent.id);
    expect(payload.status).toBe("translated");
  });

  it("rejects invalid pub/sub payloads", () => {
    expect(parseEventMessage("not-json")).toBeNull();
    expect(parseEventMessage(JSON.stringify({ type: "heartbeat" }))).toBeNull();
  });
});
