import { describe, it, expect } from "vitest";
import { parseEventFilterParams } from "./useEventFilters";

describe("parseEventFilterParams", () => {
  it("returns undefined for missing numeric values", () => {
    const filters = parseEventFilterParams({
      contractId: "CABC",
      eventType: "Transfer",
      minAmount: "",
      startLedger: "",
      endLedger: "",
    });

    expect(filters).toEqual({
      contractId: "CABC",
      eventType: "Transfer",
      minAmount: undefined,
      startLedger: undefined,
      endLedger: undefined,
    });
  });

  it("parses valid numeric strings", () => {
    const filters = parseEventFilterParams({
      contractId: "CABC",
      eventType: "Mint",
      minAmount: "50000",
      startLedger: "52341001",
      endLedger: "52341050",
    });

    expect(filters).toEqual({
      contractId: "CABC",
      eventType: "Mint",
      minAmount: 50000,
      startLedger: 52341001,
      endLedger: 52341050,
    });
  });

  it("ignores invalid numbers and leaves them undefined", () => {
    const filters = parseEventFilterParams({
      contractId: "CABC",
      eventType: "Burn",
      minAmount: "not-a-number",
      startLedger: "52341x001",
      endLedger: "1e10",
    });

    expect(filters).toEqual({
      contractId: "CABC",
      eventType: "Burn",
      minAmount: undefined,
      startLedger: undefined,
      endLedger: 10000000000,
    });
  });
});
