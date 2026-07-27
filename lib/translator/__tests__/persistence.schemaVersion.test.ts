import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RawEvent } from "../types";
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

const mockedTranslateWithCache = vi.mocked(translateWithCache);
const mockedTriggerWebhooksForEvent = vi.mocked(triggerWebhooksForEvent);
const mockedIsRedisEnabled = vi.mocked(isRedisEnabled);

const event: RawEvent = {
  id: "versioned-event-1",
  contractId: "CVERSIONEDBLUEPRINT00000000000000000000000000000000000000000",
  topics: ["0x7472616e73666572"],
  data: "0x00",
  ledger: 5000,
  timestamp: 1700000000,
  txHash: "versioned-tx-hash",
};

describe("translateAndPersistEvent schemaVersion persistence", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedTriggerWebhooksForEvent.mockResolvedValue(undefined);
    mockedIsRedisEnabled.mockReturnValue(false);
  });

  it("writes the schemaVersion computed by a versioned blueprint to the database on create", async () => {
    mockedTranslateWithCache.mockResolvedValueOnce({
      raw: event,
      description: "Transferred 100 USDC",
      status: "translated",
      blueprintName: "Stellar Asset Contract (SAC)",
      eventType: "Transfer",
      schemaVersion: "1.0.0",
    });

    const upsertSpy = vi.spyOn(db.event, "upsert").mockResolvedValue({
      id: event.id,
      schemaVersion: "1.0.0",
    } as never);

    const result = await Persistence.translateAndPersistEvent(event);

    expect(result?.schemaVersion).toBe("1.0.0");
    expect(upsertSpy).toHaveBeenCalledTimes(1);
    expect(upsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: event.id },
        create: expect.objectContaining({ schemaVersion: "1.0.0" }),
        update: expect.objectContaining({ schemaVersion: "1.0.0" }),
      })
    );
  });

  it("re-persists an updated schemaVersion after a blueprint upgrade", async () => {
    mockedTranslateWithCache.mockResolvedValueOnce({
      raw: event,
      description: "Transferred 100 USDC",
      status: "translated",
      blueprintName: "Stellar Asset Contract (SAC)",
      eventType: "Transfer",
      schemaVersion: "2.0.0",
    });

    const upsertSpy = vi.spyOn(db.event, "upsert").mockResolvedValue({
      id: event.id,
      schemaVersion: "2.0.0",
    } as never);

    await Persistence.translateAndPersistEvent(event);

    expect(upsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ schemaVersion: "2.0.0" }),
      })
    );
  });

  it("persists a null schemaVersion when no blueprint applied", async () => {
    mockedTranslateWithCache.mockResolvedValueOnce({
      raw: event,
      description: null,
      status: "cryptic",
      blueprintName: null,
      eventType: null,
      schemaVersion: null,
    });

    const upsertSpy = vi.spyOn(db.event, "upsert").mockResolvedValue({
      id: event.id,
      schemaVersion: null,
    } as never);

    await Persistence.translateAndPersistEvent(event);

    expect(upsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ schemaVersion: null }),
        update: expect.objectContaining({ schemaVersion: null }),
      })
    );
  });
});
