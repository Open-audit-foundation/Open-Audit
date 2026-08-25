/**
 * Tests for the useEventSearch hook.
 *
 * These tests verify:
 * - Worker lifecycle management (proper cleanup on unmount)
 * - Debounced search (worker isn't messaged on every keystroke)
 * - Index building and incremental updates
 * - Search result handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useEventSearch } from "../hooks/useEventSearch";
import type { TranslatedEvent } from "../translator/types";

// ---------------------------------------------------------------------------
// Mock the EventSearchClient
// ---------------------------------------------------------------------------

const mockBuildIndex = vi.fn().mockResolvedValue(undefined);
const mockSearch = vi.fn().mockResolvedValue([]);
const mockAddEvents = vi.fn().mockResolvedValue(0);
const mockRemoveEvents = vi.fn().mockResolvedValue(0);
const mockDestroy = vi.fn();

vi.mock("../workers/eventSearchClient", () => ({
  EventSearchClient: vi.fn().mockImplementation(() => ({
    buildIndex: mockBuildIndex,
    search: mockSearch,
    addEvents: mockAddEvents,
    removeEvents: mockRemoveEvents,
    destroy: mockDestroy,
  })),
}));

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeTranslatedEvent(id: string, contractId: string, description: string): TranslatedEvent {
  return {
    raw: {
      id,
      contractId,
      topics: ["0x1234"],
      data: "0xabcd",
      ledger: 100,
      timestamp: Date.now(),
      txHash: "tx123",
    },
    description,
    status: "translated",
    blueprintName: null,
    eventType: "transfer",
    schemaVersion: null,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useEventSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("cleans up the worker on unmount", async () => {
    const { result, unmount } = renderHook(() => useEventSearch());

    // Build index to instantiate the client, then unmount.
    const events = [makeTranslatedEvent("ev1", "CABC...", "Transfer")];

    await act(async () => {
      result.current.buildIndex(events);
    });

    unmount();

    // The destroy method should be called on unmount.
    expect(mockDestroy).toHaveBeenCalled();
  });

  it("does not search on every keystroke (debounced)", async () => {
    const { result } = renderHook(() => useEventSearch({ debounceMs: 300 }));

    // Build index first so search is enabled.
    const events = [
      makeTranslatedEvent("ev1", "CABC...", "Transfer 100 USDC"),
    ];

    await act(async () => {
      result.current.buildIndex(events);
    });

    // Simulate rapid keystrokes.
    act(() => {
      result.current.search("t");
      result.current.search("tr");
      result.current.search("tra");
      result.current.search("tran");
      result.current.search("trans");
    });

    // Before debounce fires, search should not have been called.
    expect(mockSearch).not.toHaveBeenCalled();

    // Advance timers past the debounce.
    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    // Only the last search call should have been made.
    expect(mockSearch).toHaveBeenCalledTimes(1);
    expect(mockSearch).toHaveBeenCalledWith("trans", { limit: 50 });
  });

  it("builds the search index", async () => {
    const { result } = renderHook(() => useEventSearch());

    const events = [
      makeTranslatedEvent("ev1", "CABC...", "Transfer 100 USDC"),
      makeTranslatedEvent("ev2", "CABC...", "Transfer 200 XLM"),
    ];

    await act(async () => {
      result.current.buildIndex(events);
    });

    expect(mockBuildIndex).toHaveBeenCalledWith(events, expect.any(String));
  });

  it("increments the search index with addEvents", async () => {
    const { result } = renderHook(() => useEventSearch());

    const events = [
      makeTranslatedEvent("ev1", "CABC...", "Transfer 100 USDC"),
    ];

    await act(async () => {
      result.current.buildIndex(events);
    });

    const newEvents = [
      makeTranslatedEvent("ev2", "CABC...", "Transfer 200 XLM"),
    ];

    await act(async () => {
      result.current.addEvents(newEvents);
    });

    expect(mockAddEvents).toHaveBeenCalledWith(newEvents);
  });

  it("returns search results", async () => {
    mockSearch.mockResolvedValueOnce([
      { id: "ev1", score: 10 },
      { id: "ev2", score: 5 },
    ]);

    const { result } = renderHook(() => useEventSearch());

    const events = [
      makeTranslatedEvent("ev1", "CABC...", "Transfer 100 USDC"),
      makeTranslatedEvent("ev2", "CABC...", "Transfer 200 XLM"),
    ];

    await act(async () => {
      result.current.buildIndex(events);
    });

    // Search and wait for results.
    act(() => {
      result.current.search("transfer");
    });

    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    expect(result.current.results).toEqual([
      { id: "ev1", score: 10 },
      { id: "ev2", score: 5 },
    ]);
  });

  it("clears results when clearResults is called", async () => {
    mockSearch.mockResolvedValueOnce([{ id: "ev1", score: 10 }]);

    const { result } = renderHook(() => useEventSearch());

    const events = [makeTranslatedEvent("ev1", "CABC...", "Transfer")];

    await act(async () => {
      result.current.buildIndex(events);
    });

    act(() => {
      result.current.search("transfer");
    });

    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    expect(result.current.results.length).toBe(1);

    act(() => {
      result.current.clearResults();
    });

    expect(result.current.results).toEqual([]);
  });

  it("handles empty query by clearing results", async () => {
    const { result } = renderHook(() => useEventSearch());

    act(() => {
      result.current.search("");
    });

    expect(result.current.results).toEqual([]);
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it("reports isFallback=false when Worker is available", async () => {
    const { result } = renderHook(() => useEventSearch());

    expect(result.current.isFallback).toBe(false);
  });
});
