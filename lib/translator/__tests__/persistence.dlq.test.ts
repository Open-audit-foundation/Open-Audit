import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RawEvent, TranslatedEvent } from "../types";
import * as Persistence from "../persistence";
import { db } from "../../db/client";
import { translateWithCache } from "../registry";
import { triggerWebhooksForEvent } from "../../jobs/queue";
import { isRedisEnabled } from "../../cache/redisCache";

vi.mock("../registry", async () => {
  return {
    translateWithCache: vi.fn(),
  };
});

vi.mock("../../jobs/queue", () => ({
  triggerWebhooksForEvent: vi.fn(),
}));

vi.mock("../../cache/redisCache", () => ({
  isRedisEnabled: vi.fn(),
  setCachedTranslation: vi.fn(),
}));

vi.mock("@/lib/ipfs/offloader", () => ({
  processEventForIpfs: vi.fn(async (event: RawEvent) => ({
    data: event.data,
    topics: event.topics,
    cids: [],
  })),
}));

const mockedTranslateWithCache = vi.mocked(translateWithCache);
const mockedTriggerWebhooksForEvent = vi.mocked(triggerWebhooksForEvent);
const mockedIsRedisEnabled = vi.mocked(isRedisEnabled);

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
    mockedTriggerWebhooksForEvent.mockResolvedValue(undefined);
    mockedIsRedisEnabled.mockReturnValue(false);
  });

  it("writes a DeadLetterEvent when translation fails", async () => {
    const testError = new Error("Invalid XDR payload");
    mockedTranslateWithCache.mockRejectedValueOnce(testError);

    const createSpy = vi.spyOn(db.deadLetterEvent, "create").mockResolvedValue({} as never);

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

  it("limits in-flight persistence operations to BATCH_CONCURRENCY", async () => {
    const previousConcurrency = process.env.BATCH_CONCURRENCY;
    process.env.BATCH_CONCURRENCY = "3";

    const rawEvents = Array.from({ length: 10 }, (_, index) => ({
      ...event,
      id: `batch-event-${index}`,
      txHash: `tx-${index}`,
    }));

    mockedTranslateWithCache.mockImplementation(async (rawEvent) => ({
      raw: rawEvent,
      description: `Translated ${rawEvent.id}`,
      status: "translated",
      blueprintName: "Test Blueprint",
      eventType: "Test Event",
      schemaVersion: null,
    }));

    let started = 0;
    let inFlight = 0;
    let maxInFlight = 0;

    let releaseUpserts: (() => void) | undefined;
    const upsertGate = new Promise<void>((resolve) => {
      releaseUpserts = resolve;
    });

    const upsertSpy = vi.spyOn(db.event, "upsert").mockImplementation(async ({ create }) => {
      started += 1;
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);

      await upsertGate;

      inFlight -= 1;

      return {
        ...create,
        updatedAt: new Date(),
      } as never;
    });

    try {
      const batchPromise = Persistence.translateAndPersistBatch(rawEvents);

      await vi.waitFor(() => {
        expect(started).toBe(3);
      });

      expect(maxInFlight).toBe(3);

      releaseUpserts?.();

      const result = await batchPromise;

      expect(result.successful).toBe(rawEvents.length);
      expect(result.failed).toBe(0);
      expect(result.translated).toHaveLength(rawEvents.length);
      expect(upsertSpy).toHaveBeenCalledTimes(rawEvents.length);
      expect(maxInFlight).toBeLessThanOrEqual(3);
    } finally {
      process.env.BATCH_CONCURRENCY = previousConcurrency;
    }
  });
});
