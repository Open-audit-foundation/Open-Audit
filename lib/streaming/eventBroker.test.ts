import { describe, it, expect, vi } from "vitest";
import broker, { StreamFilter } from "./eventBroker";
import type { TranslatedEvent } from "../translator/types";

function makeEvent(overrides: Partial<TranslatedEvent["raw"]> & Partial<TranslatedEvent> = {}): TranslatedEvent {
  return {
    raw: {
      id: overrides.id ?? "evt-1",
      contractId: overrides.contractId ?? "CABC123",
      topics: [],
      data: "",
      ledger: 100,
      timestamp: Date.now(),
      txHash: "txhash",
    },
    description: overrides.description ?? "Transfer of 100 XLM",
    status: "translated",
    blueprintName: "SAC",
    eventType: overrides.eventType ?? "Transfer",
  };
}

describe("EventBroker", () => {
  it("delivers published events to a subscriber", () => {
    const received: TranslatedEvent[] = [];
    const unsub = broker.subscribe({}, (e) => received.push(e));

    const event = makeEvent();
    broker.publish(event);
    unsub();

    expect(received).toHaveLength(1);
    expect(received[0]).toBe(event);
  });

  it("filters by contractId — delivers matching, drops non-matching", () => {
    const received: TranslatedEvent[] = [];
    const unsub = broker.subscribe({ contractId: "CABC123" }, (e) => received.push(e));

    broker.publish(makeEvent({ contractId: "CABC123" }));
    broker.publish(makeEvent({ contractId: "COTHER" }));
    unsub();

    expect(received).toHaveLength(1);
    expect(received[0].raw.contractId).toBe("CABC123");
  });

  it("filters by search string (case-insensitive) — matches description", () => {
    const received: TranslatedEvent[] = [];
    const unsub = broker.subscribe({ search: "swap" }, (e) => received.push(e));

    broker.publish(makeEvent({ description: "Swap 50 XLM for USDC" }));
    broker.publish(makeEvent({ description: "Transfer of 100 XLM" }));
    unsub();

    expect(received).toHaveLength(1);
    expect(received[0].description).toContain("Swap");
  });

  it("filters by search string — matches eventType", () => {
    const received: TranslatedEvent[] = [];
    const unsub = broker.subscribe({ search: "transfer" }, (e) => received.push(e));

    broker.publish(makeEvent({ eventType: "Transfer", description: "Moved funds" }));
    broker.publish(makeEvent({ eventType: "Swap", description: "Swapped tokens" }));
    unsub();

    expect(received).toHaveLength(1);
  });

  it("unsubscribe stops delivery", () => {
    const received: TranslatedEvent[] = [];
    const unsub = broker.subscribe({}, (e) => received.push(e));

    broker.publish(makeEvent({ id: "e1" }));
    unsub();
    broker.publish(makeEvent({ id: "e2" }));

    expect(received).toHaveLength(1);
  });

  it("delivers to multiple independent subscribers", () => {
    const a: TranslatedEvent[] = [];
    const b: TranslatedEvent[] = [];
    const unsubA = broker.subscribe({}, (e) => a.push(e));
    const unsubB = broker.subscribe({ contractId: "CABC123" }, (e) => b.push(e));

    broker.publish(makeEvent({ contractId: "CABC123" }));
    broker.publish(makeEvent({ contractId: "COTHER" }));
    unsubA();
    unsubB();

    expect(a).toHaveLength(2); // no filter
    expect(b).toHaveLength(1); // filtered
  });

  it("publish → subscriber fires synchronously (well under 1 s)", () => {
    const timestamps: number[] = [];
    const unsub = broker.subscribe({}, () => timestamps.push(Date.now()));

    const before = Date.now();
    broker.publish(makeEvent());
    unsub();

    expect(timestamps).toHaveLength(1);
    expect(timestamps[0] - before).toBeLessThan(50); // sync, should be < 1 ms
  });
});
