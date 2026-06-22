import { PassThrough } from "stream";
import { EventEmitter } from "events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Horizon, SorobanRpc, StrKey, xdr } from "stellar-sdk";
import {
  DEFAULT_RETRY_CONFIG,
  calculateRetryDelay,
  createMemoryIngestionStateStore,
  fetchEventsWithRetry,
  startEventIndexer,
  startHorizonStreamingIndexer,
  startResilientEventIngestion,
} from "../indexer";

vi.mock("../../cache/redisCache", () => ({
  initRedis: vi.fn(),
  getCachedEvents: vi.fn().mockResolvedValue(null),
  setCachedEvents: vi.fn().mockResolvedValue(undefined),
  isRedisEnabled: vi.fn().mockReturnValue(false),
}));

vi.mock("../../telemetry/index", () => ({
  captureExceptionSync: vi.fn(),
}));

vi.mock("stellar-sdk", () => ({
  SorobanRpc: {
    Server: vi.fn(),
  },
  Horizon: {
    Server: vi.fn(),
  },
  StrKey: {
    encodeContract: vi.fn((value) => `C-${String(value)}`),
  },
  xdr: {
    TransactionMeta: {
      fromXDR: vi.fn(),
      v3: () => ({ switch: () => "v3" }),
    },
  },
}));

const NETWORK_CONFIG = {
  horizonUrl: "https://horizon-testnet.stellar.org",
  sorobanRpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
};

describe("calculateRetryDelay", () => {
  it("caps exponential backoff at the configured maximum", () => {
    expect(calculateRetryDelay(0, DEFAULT_RETRY_CONFIG)).toBe(1000);
    expect(calculateRetryDelay(3, DEFAULT_RETRY_CONFIG)).toBe(8000);
    expect(calculateRetryDelay(10, DEFAULT_RETRY_CONFIG)).toBe(32000);
  });
});

describe("fetchEventsWithRetry", () => {
  it("returns the first successful response", async () => {
    const server = {
      getEvents: vi.fn().mockResolvedValue({
        events: [{ id: "evt-1" }],
        latestLedger: 200,
      }),
    };

    const response = await fetchEventsWithRetry(
      server as unknown as SorobanRpc.Server,
      ["contract-1"],
      100
    );

    expect(response.latestLedger).toBe(200);
    expect(server.getEvents).toHaveBeenCalledTimes(1);
  });

  it("retries retriable failures and eventually succeeds", async () => {
    const server = {
      getEvents: vi
        .fn()
        .mockRejectedValueOnce(new Error("429 Too Many Requests"))
        .mockResolvedValueOnce({
          events: [{ id: "evt-2" }],
          latestLedger: 201,
        }),
    };

    const response = await fetchEventsWithRetry(
      server as unknown as SorobanRpc.Server,
      ["contract-1"],
      100,
      undefined,
      {
        initialDelayMs: 1,
        maxDelayMs: 2,
        maxRetries: 1,
        backoffMultiplier: 2,
      }
    );

    expect(response.latestLedger).toBe(201);
    expect(server.getEvents).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting retries", async () => {
    const server = {
      getEvents: vi.fn().mockRejectedValue(new Error("429 Too Many Requests")),
    };

    await expect(
      fetchEventsWithRetry(server as unknown as SorobanRpc.Server, ["contract-1"], 100, undefined, {
        initialDelayMs: 1,
        maxDelayMs: 2,
        maxRetries: 1,
        backoffMultiplier: 2,
      })
    ).rejects.toThrow(/Failed to fetch events after 1 retries/);
  });
});

describe("startEventIndexer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("restores and persists state store progress", async () => {
    const stateStore = createMemoryIngestionStateStore({
      lastLedger: 250,
      pagingToken: "cursor-250",
      updatedAt: new Date().toISOString(),
      source: "rpc",
    });

    const server = {
      getEvents: vi.fn().mockResolvedValue({
        events: [{ id: "evt-3" }],
        latestLedger: 300,
        cursor: "cursor-300",
      }),
    };

    vi.mocked(SorobanRpc.Server).mockImplementation(() => server as any);

    const indexer = startEventIndexer({
      networkConfig: NETWORK_CONFIG,
      contractIds: ["contract-1"],
      startLedger: 100,
      pollIntervalMs: 5000,
      stateStore,
      onEvents: vi.fn(),
    });

    await vi.advanceTimersByTimeAsync(50);

    expect(server.getEvents).toHaveBeenCalledWith({
      startLedger: 250,
      filters: [{ type: "contract", contractIds: ["contract-1"] }],
    });
    await expect(stateStore.load()).resolves.toMatchObject({
      lastLedger: 300,
      pagingToken: "cursor-300",
      source: "rpc",
    });

    indexer.stop();
  });
});

describe("startHorizonStreamingIndexer", () => {
  it("starts from the stored cursor and persists new paging tokens", async () => {
    const stateStore = createMemoryIngestionStateStore({
      lastLedger: 999,
      pagingToken: "stored-token",
      updatedAt: new Date().toISOString(),
      source: "horizon",
    });

    const topic = { toXDR: vi.fn().mockReturnValue("746f706963") };
    const data = { toXDR: vi.fn().mockReturnValue("64617461") };
    const contractEvent = {
      contractId: vi.fn().mockReturnValue("abc"),
      body: vi.fn().mockReturnValue({
        v0: () => ({
          topics: () => [topic],
          data: () => data,
        }),
      }),
    };

    vi.mocked(xdr.TransactionMeta.fromXDR).mockReturnValue({
      switch: () => "v3",
      v3: () => ({
        sorobanMeta: () => ({
          events: () => [contractEvent],
        }),
      }),
    } as any);

    const streamHandlers: { onmessage?: (tx: any) => Promise<void>; onerror?: (err: unknown) => void } = {};
    const cursor = vi.fn(() => ({
      stream: vi.fn((handlers) => {
        streamHandlers.onmessage = handlers.onmessage;
        streamHandlers.onerror = handlers.onerror;
        return vi.fn();
      }),
    }));

    vi.mocked(Horizon.Server).mockImplementation(() => ({
      transactions: () => ({ cursor }),
    }) as any);

    const onEvent = vi.fn();
    const controls = startHorizonStreamingIndexer({
      networkConfig: NETWORK_CONFIG,
      stateStore,
      onEvent,
    });

    await vi.waitFor(() => {
      expect(cursor).toHaveBeenCalledWith("stored-token");
    });

    await streamHandlers.onmessage?.({
      id: "tx-1",
      hash: "hash-1",
      ledger_attr: 1001,
      paging_token: "next-token",
      result_meta_xdr: "AAAA",
    });

    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "tx-1-0",
        contractId: "C-abc",
        ledger: 1001,
        txHash: "hash-1",
      })
    );
    await expect(stateStore.load()).resolves.toMatchObject({
      lastLedger: 1001,
      pagingToken: "next-token",
      source: "horizon",
    });

    controls.stop();
  });
});

describe("startResilientEventIngestion", () => {
  it("falls back to RPC ingestion after captive core exits", async () => {
    const stateStore = createMemoryIngestionStateStore();
    const child = new EventEmitter() as EventEmitter & {
      stdout: PassThrough;
      stderr: PassThrough;
      kill: ReturnType<typeof vi.fn>;
    };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = vi.fn();

    const rpcServer = {
      getEvents: vi.fn().mockResolvedValue({
        events: [
          {
            id: "rpc-event-1",
            contractId: "contract-1",
            ledger: 501,
            pagingToken: "rpc-cursor-501",
            topics: ["topic-1"],
            data: "payload-1",
            txHash: "hash-501",
          },
        ],
        latestLedger: 501,
        cursor: "rpc-cursor-501",
      }),
    };

    vi.mocked(SorobanRpc.Server).mockImplementation(() => rpcServer as any);

    const onEvent = vi.fn();
    startResilientEventIngestion({
      networkConfig: NETWORK_CONFIG,
      contractIds: ["contract-1"],
      stateStore,
      onEvent,
      captiveCore: {
        binaryPath: "stellar-core",
        networkPassphrase: NETWORK_CONFIG.networkPassphrase,
        historyArchives: { archive: "https://history.example.com" },
        transport: { type: "stdio" },
        startupTimeoutMs: 10000,
        maxRestartAttempts: 0,
        spawnFn: vi.fn(() => child as any),
        decoder: vi.fn(() => ({
          sequence: 500,
          rawEvents: [],
          rawXdr: "AAAA",
          receivedAt: new Date().toISOString(),
        })),
      },
    });

    await Promise.resolve();
    child.emit("exit", 1, null);

    await vi.waitFor(() => {
      expect(rpcServer.getEvents).toHaveBeenCalled();
      expect(onEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "rpc-event-1",
          contractId: "contract-1",
          ledger: 501,
        })
      );
    });
  });
});
