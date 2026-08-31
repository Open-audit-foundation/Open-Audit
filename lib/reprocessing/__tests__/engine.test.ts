import { describe, it, expect, vi } from "vitest";
import {
  reprocessItems,
  type ReprocessItem,
  type ProcessItemResult,
  type ReprocessCallbacks,
} from "../engine";

describe("reprocessItems", () => {
  describe("empty input", () => {
    it("returns empty result when given no items", async () => {
      const processMock = vi.fn();
      const persistMock = vi.fn();

      const result = await reprocessItems(
        [],
        { process: processMock, persist: persistMock },
        { batchSize: 10, dryRun: false }
      );

      expect(result).toEqual({
        totalDiscovered: 0,
        totalSucceeded: 0,
        totalFailed: 0,
        batchCount: 0,
        dryRun: false,
        batches: [],
        failures: [],
      });

      expect(processMock).not.toHaveBeenCalled();
      expect(persistMock).not.toHaveBeenCalled();
    });
  });

  describe("batch processing", () => {
    it("processes items in bounded batches", async () => {
      const items: ReprocessItem<number>[] = Array.from({ length: 25 }, (_, i) => ({
        id: `item-${i}`,
        data: i,
      }));

      const processMock = vi.fn(async (item: ReprocessItem<number>): Promise<ProcessItemResult> => ({
        id: item.id,
        success: true,
      }));

      const persistMock = vi.fn();

      const result = await reprocessItems(items, { process: processMock, persist: persistMock }, {
        batchSize: 10,
        dryRun: false,
      });

      // Should create 3 batches: 10, 10, 5
      expect(result.batchCount).toBe(3);
      expect(result.batches).toHaveLength(3);
      expect(result.batches[0].total).toBe(10);
      expect(result.batches[1].total).toBe(10);
      expect(result.batches[2].total).toBe(5);

      // All items should be processed
      expect(processMock).toHaveBeenCalledTimes(25);
      expect(result.totalDiscovered).toBe(25);
    });

    it("respects custom batch size", async () => {
      const items: ReprocessItem<string>[] = Array.from({ length: 100 }, (_, i) => ({
        id: `item-${i}`,
        data: `data-${i}`,
      }));

      const processMock = vi.fn(
        async (item) => ({
          id: item.id,
          success: true,
        })
      );

      const persistMock = vi.fn();

      const result = await reprocessItems(items, { process: processMock, persist: persistMock }, {
        batchSize: 25,
        dryRun: false,
      });

      // Should create exactly 4 batches of 25
      expect(result.batchCount).toBe(4);
      expect(result.batches.every((b) => b.total === 25)).toBe(true);
    });

    it("defaults to batch size of 50", async () => {
      const items: ReprocessItem<string>[] = Array.from({ length: 75 }, (_, i) => ({
        id: `item-${i}`,
        data: `data-${i}`,
      }));

      const processMock = vi.fn(
        async (item) => ({
          id: item.id,
          success: true,
        })
      );

      const persistMock = vi.fn();

      // Call without explicit batchSize
      const result = await reprocessItems(
        items,
        { process: processMock, persist: persistMock },
        { dryRun: false }
      );

      // Should create 2 batches: 50, 25
      expect(result.batchCount).toBe(2);
      expect(result.batches[0].total).toBe(50);
      expect(result.batches[1].total).toBe(25);
    });

    it("rejects invalid batch size", async () => {
      const items: ReprocessItem<string>[] = [{ id: "item-1", data: "data" }];

      const processMock = vi.fn();
      const persistMock = vi.fn();

      await expect(
        reprocessItems(items, { process: processMock, persist: persistMock }, { batchSize: 0 })
      ).rejects.toThrow("batchSize must be positive");

      await expect(
        reprocessItems(items, { process: processMock, persist: persistMock }, { batchSize: -10 })
      ).rejects.toThrow("batchSize must be positive");
    });
  });

  describe("success counting", () => {
    it("counts successful items correctly", async () => {
      const items: ReprocessItem<string>[] = [
        { id: "item-1", data: "data-1" },
        { id: "item-2", data: "data-2" },
        { id: "item-3", data: "data-3" },
      ];

      const processMock = vi.fn(
        async (item) => ({
          id: item.id,
          success: true,
        })
      );

      const persistMock = vi.fn();

      const result = await reprocessItems(
        items,
        { process: processMock, persist: persistMock },
        { batchSize: 10, dryRun: false }
      );

      expect(result.totalSucceeded).toBe(3);
      expect(result.totalFailed).toBe(0);
      expect(result.batches[0].succeeded).toBe(3);
      expect(result.batches[0].failed).toBe(0);
    });
  });

  describe("failure handling", () => {
    it("records failed items without aborting the batch", async () => {
      const items: ReprocessItem<string>[] = [
        { id: "item-1", data: "valid" },
        { id: "item-2", data: "invalid" },
        { id: "item-3", data: "valid" },
        { id: "item-4", data: "invalid" },
        { id: "item-5", data: "valid" },
      ];

      const processMock = vi.fn(
        async (item) => {
          if (item.data === "invalid") {
            return {
              id: item.id,
              success: false,
              error: {
                message: "Invalid data",
                code: "INVALID_DATA",
              },
            };
          }
          return { id: item.id, success: true };
        }
      );

      const persistMock = vi.fn();

      const result = await reprocessItems(
        items,
        { process: processMock, persist: persistMock },
        { batchSize: 10, dryRun: false }
      );

      // All items should be processed despite failures
      expect(processMock).toHaveBeenCalledTimes(5);
      expect(result.totalSucceeded).toBe(3);
      expect(result.totalFailed).toBe(2);

      // Failures should be recorded
      expect(result.failures).toHaveLength(2);
      expect(result.failures).toEqual([
        { id: "item-2", error: "Invalid data", code: "INVALID_DATA" },
        { id: "item-4", error: "Invalid data", code: "INVALID_DATA" },
      ]);
    });

    it("captures unexpected errors during processing", async () => {
      const items: ReprocessItem<string>[] = [
        { id: "item-1", data: "good" },
        { id: "item-2", data: "throws" },
        { id: "item-3", data: "good" },
      ];

      const processMock = vi.fn(
        async (item) => {
          if (item.data === "throws") {
            throw new Error("Unexpected processing error");
          }
          return { id: item.id, success: true };
        }
      );

      const persistMock = vi.fn();

      const result = await reprocessItems(
        items,
        { process: processMock, persist: persistMock },
        { batchSize: 10, dryRun: false }
      );

      // Processing continues despite exception
      expect(processMock).toHaveBeenCalledTimes(3);
      expect(result.totalSucceeded).toBe(2);
      expect(result.totalFailed).toBe(1);

      // Exception should be captured as a failure
      expect(result.failures).toEqual([
        { id: "item-2", error: "Unexpected processing error", code: "UNEXPECTED_ERROR" },
      ]);
    });

    it("handles persistence failures gracefully", async () => {
      const items: ReprocessItem<string>[] = [
        { id: "item-1", data: "data-1" },
        { id: "item-2", data: "data-2" },
      ];

      const processMock = vi.fn(
        async (item) => ({
          id: item.id,
          success: true,
        })
      );

      const persistMock = vi.fn().mockRejectedValue(new Error("Database connection failed"));

      const result = await reprocessItems(
        items,
        { process: processMock, persist: persistMock },
        { batchSize: 10, dryRun: false }
      );

      // Items that "succeeded" in processing should be marked as failed
      // due to persistence failure
      expect(result.totalSucceeded).toBe(0);
      expect(result.totalFailed).toBe(2);

      expect(result.failures).toHaveLength(2);
      expect(result.failures[0].error).toContain("Persistence failed");
      expect(result.failures[0].code).toBe("PERSIST_ERROR");
    });

    it("continues to next batch after persistence failure", async () => {
      const items: ReprocessItem<string>[] = Array.from({ length: 15 }, (_, i) => ({
        id: `item-${i}`,
        data: `data-${i}`,
      }));

      const processMock = vi.fn(
        async (item) => ({
          id: item.id,
          success: true,
        })
      );

      // Fail on first call, succeed on second
      const persistMock = vi
        .fn()
        .mockRejectedValueOnce(new Error("First batch failed"))
        .mockResolvedValueOnce(undefined);

      const result = await reprocessItems(
        items,
        { process: processMock, persist: persistMock },
        { batchSize: 10, dryRun: false }
      );

      // Should process all batches despite first batch persistence failure
      expect(result.batchCount).toBe(2);
      expect(processMock).toHaveBeenCalledTimes(15);

      // First batch (10 items) failed persistence
      // Second batch (5 items) succeeded
      expect(result.batches[0].succeeded).toBe(0); // Rolled back due to persist error
      expect(result.batches[0].failed).toBe(10);
      expect(result.batches[1].succeeded).toBe(5);
      expect(result.batches[1].failed).toBe(0);
    });
  });

  describe("dry-run mode", () => {
    it("processes items but never calls persist in dry-run mode", async () => {
      const items: ReprocessItem<string>[] = [
        { id: "item-1", data: "data-1" },
        { id: "item-2", data: "data-2" },
        { id: "item-3", data: "data-3" },
      ];

      const processMock = vi.fn(
        async (item) => ({
          id: item.id,
          success: true,
        })
      );

      // This mock should NEVER be called in dry-run mode
      const persistMock = vi.fn(() => {
        throw new Error("persist() was called in dry-run mode!");
      });

      const result = await reprocessItems(
        items,
        { process: processMock, persist: persistMock },
        { batchSize: 10, dryRun: true }
      );

      // Process should be called
      expect(processMock).toHaveBeenCalledTimes(3);

      // Persist should NEVER be called
      expect(persistMock).not.toHaveBeenCalled();

      // Result should indicate dry-run
      expect(result.dryRun).toBe(true);
      expect(result.totalSucceeded).toBe(3);
    });

    it("dry-run flag defaults to false", async () => {
      const items: ReprocessItem<string>[] = [{ id: "item-1", data: "data-1" }];

      const processMock = vi.fn(
        async (item) => ({
          id: item.id,
          success: true,
        })
      );

      const persistMock = vi.fn();

      const result = await reprocessItems(items, { process: processMock, persist: persistMock });

      // Should call persist when dryRun is not explicitly set
      expect(persistMock).toHaveBeenCalledTimes(1);
      expect(result.dryRun).toBe(false);
    });

    it("does not call persist when all items fail in dry-run", async () => {
      const items: ReprocessItem<string>[] = [
        { id: "item-1", data: "fail" },
        { id: "item-2", data: "fail" },
      ];

      const processMock = vi.fn(
        async (item) => ({
          id: item.id,
          success: false,
          error: { message: "Failed" },
        })
      );

      const persistMock = vi.fn(() => {
        throw new Error("persist() should not be called when no successes");
      });

      const result = await reprocessItems(
        items,
        { process: processMock, persist: persistMock },
        { batchSize: 10, dryRun: true }
      );

      expect(persistMock).not.toHaveBeenCalled();
      expect(result.totalFailed).toBe(2);
      expect(result.dryRun).toBe(true);
    });

    it("skips persist even with successful items in dry-run across multiple batches", async () => {
      const items: ReprocessItem<string>[] = Array.from({ length: 25 }, (_, i) => ({
        id: `item-${i}`,
        data: `data-${i}`,
      }));

      const processMock = vi.fn(
        async (item) => ({
          id: item.id,
          success: true,
        })
      );

      const persistMock = vi.fn(() => {
        throw new Error("persist() was called in dry-run mode!");
      });

      const result = await reprocessItems(
        items,
        { process: processMock, persist: persistMock },
        { batchSize: 10, dryRun: true }
      );

      // Multiple batches, all successful
      expect(result.batchCount).toBe(3);
      expect(result.totalSucceeded).toBe(25);

      // But persist should NEVER be called
      expect(persistMock).not.toHaveBeenCalled();
      expect(result.dryRun).toBe(true);
    });
  });

  describe("multiple batches", () => {
    it("aggregates statistics correctly across multiple batches", async () => {
      const items: ReprocessItem<string>[] = [
        // Batch 1: 3 items (2 success, 1 fail)
        { id: "item-1", data: "good" },
        { id: "item-2", data: "bad" },
        { id: "item-3", data: "good" },
        // Batch 2: 3 items (1 success, 2 fail)
        { id: "item-4", data: "good" },
        { id: "item-5", data: "bad" },
        { id: "item-6", data: "bad" },
        // Batch 3: 2 items (2 success, 0 fail)
        { id: "item-7", data: "good" },
        { id: "item-8", data: "good" },
      ];

      const processMock = vi.fn(
        async (item) => {
          if (item.data === "bad") {
            return {
              id: item.id,
              success: false,
              error: { message: "Bad data" },
            };
          }
          return { id: item.id, success: true };
        }
      );

      const persistMock = vi.fn();

      const result = await reprocessItems(
        items,
        { process: processMock, persist: persistMock },
        { batchSize: 3, dryRun: false }
      );

      // Aggregate stats
      expect(result.batchCount).toBe(3);
      expect(result.totalDiscovered).toBe(8);
      expect(result.totalSucceeded).toBe(5);
      expect(result.totalFailed).toBe(3);

      // Per-batch stats
      expect(result.batches[0].succeeded).toBe(2);
      expect(result.batches[0].failed).toBe(1);
      expect(result.batches[1].succeeded).toBe(1);
      expect(result.batches[1].failed).toBe(2);
      expect(result.batches[2].succeeded).toBe(2);
      expect(result.batches[2].failed).toBe(0);

      // Failures
      expect(result.failures).toHaveLength(3);
    });
  });

  describe("persist callback behavior", () => {
    it("only passes successful results to persist callback", async () => {
      const items: ReprocessItem<string>[] = [
        { id: "item-1", data: "good" },
        { id: "item-2", data: "bad" },
        { id: "item-3", data: "good" },
      ];

      const processMock = vi.fn(
        async (item) => {
          if (item.data === "bad") {
            return {
              id: item.id,
              success: false,
              error: { message: "Bad" },
            };
          }
          return { id: item.id, success: true };
        }
      );

      const persistMock = vi.fn();

      await reprocessItems(
        items,
        { process: processMock, persist: persistMock },
        { batchSize: 10, dryRun: false }
      );

      // Persist should be called once with only successful results
      expect(persistMock).toHaveBeenCalledTimes(1);
      const persistedResults = persistMock.mock.calls[0][0];
      expect(persistedResults).toHaveLength(2);
      expect(persistedResults.every((r: ProcessItemResult) => r.success)).toBe(true);
      expect(persistedResults.map((r: ProcessItemResult) => r.id)).toEqual(["item-1", "item-3"]);
    });

    it("skips persist when batch has no successful items", async () => {
      const items: ReprocessItem<string>[] = [
        { id: "item-1", data: "bad" },
        { id: "item-2", data: "bad" },
      ];

      const processMock = vi.fn(
        async (item) => ({
          id: item.id,
          success: false,
          error: { message: "Bad" },
        })
      );

      const persistMock = vi.fn();

      await reprocessItems(
        items,
        { process: processMock, persist: persistMock },
        { batchSize: 10, dryRun: false }
      );

      // No successful items, so persist should not be called
      expect(persistMock).not.toHaveBeenCalled();
    });

    it("calls persist separately for each batch", async () => {
      const items: ReprocessItem<string>[] = Array.from({ length: 25 }, (_, i) => ({
        id: `item-${i}`,
        data: "good",
      }));

      const processMock = vi.fn(
        async (item) => ({
          id: item.id,
          success: true,
        })
      );

      const persistMock = vi.fn();

      await reprocessItems(
        items,
        { process: processMock, persist: persistMock },
        { batchSize: 10, dryRun: false }
      );

      // Should call persist once per batch (3 batches)
      expect(persistMock).toHaveBeenCalledTimes(3);

      // First two calls should have 10 items, last should have 5
      expect(persistMock.mock.calls[0][0]).toHaveLength(10);
      expect(persistMock.mock.calls[1][0]).toHaveLength(10);
      expect(persistMock.mock.calls[2][0]).toHaveLength(5);
    });
  });
});
