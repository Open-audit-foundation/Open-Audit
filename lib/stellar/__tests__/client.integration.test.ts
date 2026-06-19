import { describe, it, expect } from "vitest";
import { fetchContractEvents, TESTNET_CONFIG } from "../client";

describe("client integration with MSW", () => {
  it("should successfully fetch contract events without live network connection", async () => {
    const contractId = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";

    // fetchContractEvents calls getLatestLedger then getEvents;
    // MSW (in vitest.setup.ts) intercepts these requests.
    const events = await fetchContractEvents(contractId, TESTNET_CONFIG, 123456);

    expect(events).toBeDefined();
    expect(events.length).toBe(1);
    // RawEvent shape: { id, contractId, topics, data, ledger, timestamp, txHash }
    expect(events[0].contractId).toBe(contractId);
    expect(events[0].id).toBeDefined();
    expect(Array.isArray(events[0].topics)).toBe(true);
    expect(events[0].ledger).toBe(123456);
  });
});
