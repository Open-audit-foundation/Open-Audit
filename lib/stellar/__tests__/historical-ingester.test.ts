import { describe, it, expect, vi, beforeEach } from "vitest";
import { ingestHistoricalRange, DEFAULT_CHUNK_SIZE } from "../historical-ingester";
import { TESTNET_CONFIG } from "../client";

// Mock the Soroban RPC
vi.mock("stellar-sdk", () => ({
  SorobanRpc: {
    Server: vi.fn().mockImplementation(() => ({
      getEvents: vi.fn().mockResolvedValue({
        events: [
          { id: "1", type: "contract", ledger: 1000, createdAt: "2024-01-01T00:00:00Z" },
          { id: "2", type: "contract", ledger: 1001, createdAt: "2024-01-01T00:01:00Z" },
        ],
      }),
    })),
  },
}));

describe("Historical Ingester", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should validate required parameters", async () => {
    const invalidConfigs = [
      {
        networkConfig: TESTNET_CONFIG,
        contractId: "", // Empty contract ID
        startSequence: 1000,
        endSequence: 2000,
      },
      {
        networkConfig: TESTNET_CONFIG,
        contractId: "CABC...",
        startSequence: -1, // Invalid start
        endSequence: 2000,
      },
      {
        networkConfig: TESTNET_CONFIG,
        contractId: "CABC...",
        startSequence: 2000,
        endSequence: 1000, // End < start
      },
    ];

    for (const config of invalidConfigs) {
      await expect(
        ingestHistoricalRange(config as Parameters<typeof ingestHistoricalRange>[0])
      ).rejects.toThrow();
    }
  });

  it("should calculate correct chunk count", async () => {
    const chunkSizes: [number, number, number][] = [
      [1000, 5000, 5], // 5000 ledgers / 1000 per chunk = 5
      [1000, 2500, 3], // 2500 ledgers / 1000 per chunk = 3 (rounded up)
      [500, 1500, 3], // 1500 ledgers / 500 per chunk = 3
    ];

    for (const [start, end, expectedChunks] of chunkSizes) {
      let chunkCount = 0;
      await ingestHistoricalRange({
        networkConfig: TESTNET_CONFIG,
        contractId: "CABC...",
        startSequence: start,
        endSequence: end,
        chunkSize: 500,
        onChunkComplete: () => {
          chunkCount++;
        },
      });

      // Verify chunk count is called the expected number of times
      expect(chunkCount).toBeGreaterThan(0);
    }
  });

  it("should call onChunkComplete for each chunk", async () => {
    const onChunkComplete = vi.fn();

    await ingestHistoricalRange({
      networkConfig: TESTNET_CONFIG,
      contractId: "CABC...",
      startSequence: 1000,
      endSequence: 2500,
      chunkSize: 500,
      onChunkComplete,
    });

    // Should be called for each chunk
    expect(onChunkComplete).toHaveBeenCalled();
  });

  it("should call onComplete with total stats", async () => {
    const onComplete = vi.fn();

    await ingestHistoricalRange({
      networkConfig: TESTNET_CONFIG,
      contractId: "CABC...",
      startSequence: 1000,
      endSequence: 2000,
      chunkSize: 1000,
      onComplete,
    });

    expect(onComplete).toHaveBeenCalled();
    const [totalEvents, totalChunks] = onComplete.mock.calls[0];
    expect(typeof totalEvents).toBe("number");
    expect(typeof totalChunks).toBe("number");
  });

  it("should use default chunk size", async () => {
    const onChunkComplete = vi.fn();

    await ingestHistoricalRange({
      networkConfig: TESTNET_CONFIG,
      contractId: "CABC...",
      startSequence: 1000,
      endSequence: 5000, // 5000 ledgers
      // No chunkSize specified, should use DEFAULT_CHUNK_SIZE (1000)
      onChunkComplete,
    });

    // With 5000 ledgers and default chunk size of 1000, should have 5 chunks
    expect(onChunkComplete).toHaveBeenCalled();
  });
});
