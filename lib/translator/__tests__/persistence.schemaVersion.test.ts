import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RawEvent, TranslatedEvent } from "../types";
import * as Persistence from "../persistence";
import { db } from "../../db/client";
import { translateWithCache } from "../registry";
import { isRedisEnabled } from "../../cache/redisCache";
import { triggerWebhooksForEvent } from "../../jobs/queue";

vi.mock("../registry", async () => {
  return {
    translateWithCache: vi.fn(),
  };
});

vi.mock("../../cache/redisCache", () => ({
  isRedisEnabled: vi.fn(),
  setCachedTranslation: vi.fn(),
}));

vi.mock("../../jobs/queue", () => ({
  triggerWebhooksForEvent: vi.fn(),
}));

const mockedTranslateWithCache = vi.mocked(translateWithCache);
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

describe("translateAndPersistEvent translation metadata persistence", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedIsRedisEnabled.mockReturnValue(false);
  });

  it.each([
    { status: "translated" as const, sandboxError: undefined },
    { status: "cryptic" as const, sandboxError: "RUNTIME_TRAP" },
  ])("persists community parser metadata on create and update for $status results", async ({ status, sandboxError }) => {
    const translated: TranslatedEvent = {
      raw: event,
      description: status === "translated" ? "Community translation" : null,
      status,
      blueprintName: "Community Blueprint",
      eventType: status === "translated" ? "Transfer" : null,
      schemaVersion: null,
      parserProvenance: "community-wasm",
      ...(sandboxError === undefined ? {} : { sandboxError }),
    };
    mockedTranslateWithCache.mockResolvedValueOnce(translated);
    const upsertSpy = vi.spyOn(db.event, "upsert").mockImplementation(async ({ create }) => create as never);

    const result = await Persistence.translateAndPersistEvent(event);

    const metadata = {
      parserProvenance: "community-wasm",
      sandboxError: sandboxError ?? null,
    };
    expect(result).toEqual(translated);
    expect(upsertSpy).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining(metadata),
      update: expect.objectContaining(metadata),
    }));
    expect(triggerWebhooksForEvent).toHaveBeenCalledWith(expect.objectContaining(metadata));
  });

  it("clears stale sandbox metadata when a stored event is translated natively", async () => {
    mockedTranslateWithCache.mockResolvedValueOnce({
      raw: event,
      description: "Native translation",
      status: "translated",
      blueprintName: "Native Blueprint",
      eventType: "Transfer",
      schemaVersion: null,
      parserProvenance: "native",
    });
    const upsertSpy = vi.spyOn(db.event, "upsert").mockResolvedValue({ id: event.id } as never);

    await Persistence.translateAndPersistEvent(event);

    expect(upsertSpy).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ parserProvenance: "native", sandboxError: null }),
    }));
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
