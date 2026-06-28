import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { RawEvent, TranslatedEvent } from "../types";
import * as Persistence from "../persistence";
import { db } from "@/lib/db/client";
import { translateWithCache } from "../registry";

vi.mock("../registry", async () => {
  const actual = await vi.importActual<typeof import("../registry")>("../registry");
  return {
    ...actual,
    translateWithCache: vi.fn(),
  };
});

vi.mock("@/lib/jobs/queue", () => ({
  triggerWebhooksForEvent: vi.fn(),
}));

vi.mock("@/lib/ipfs/offloader", () => ({
  processEventForIpfs: vi.fn(async (event: RawEvent) => ({
    data: event.data,
    topics: event.topics,
    cids: [],
  })),
}));

const mockedTranslateWithCache = translateWithCache as unknown as vi.MockedFunction<typeof translateWithCache>;

const event: RawEvent = {
  id: "dead-letter-1",
  contractId: "CDEADBEEF00000000000000000000000000000000000000000000000000",
  topics: ["0xdeadbeef"],
  data: "0x00",
  ledger: 1234,
  timestamp: 1672531200,
  txHash: "abcdef",
};

describe("translateAndPersistEvent DLQ", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("writes a DeadLetterEvent when translation fails", async () => {
    const testError = new Error("Invalid XDR payload");
    mockedTranslateWithCache.mockRejectedValueOnce(testError as any);

    const createSpy = vi.spyOn(db.deadLetterEvent, "create");

    const result = await Persistence.translateAndPersistEvent(event);

    expect(result).toBeNull();
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventId: event.id,
        contractId: event.contractId,
        data: event.data,
        errorCode: "INTERNAL_ERROR",
        errorMessage: "Invalid XDR payload",
      }),
    });
  });
});
