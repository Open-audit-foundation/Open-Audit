/**
 * Integration coverage for the dashboard's client-side live-feed search.
 *
 * The unit tests next to the worker already cover the indexing/search logic
 * (`lib/workers/eventSearchClient.unit.test.ts`) and the hook's debounce and
 * lifecycle behaviour with a mocked client
 * (`lib/workers/eventSearchClient.test.ts`). What is not covered there — and
 * what actually broke in a merge — is the wiring: does the *dashboard
 * component* build the index, feed new events in incrementally, debounce the
 * query, filter the feed by the hits it gets back, and tear the worker down on
 * unmount.
 *
 * The EventSearchClient module is mocked so the postMessage protocol is
 * observable; the component and hook under test are the real ones.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, cleanup, fireEvent } from "@testing-library/react";
import type { RawEvent, TranslatedEvent } from "@/lib/translator/types";

// ── EventSearchClient: observable stand-in for the worker ──────────────────

const mockBuildIndex = vi.fn().mockResolvedValue(undefined);
const mockAddEvents = vi.fn().mockResolvedValue(0);
const mockRemoveEvents = vi.fn().mockResolvedValue(0);
const mockDestroy = vi.fn();
const mockSearch = vi.fn().mockResolvedValue([]);

vi.mock("@/lib/workers/eventSearchClient", () => ({
  EventSearchClient: vi.fn().mockImplementation(() => ({
    buildIndex: mockBuildIndex,
    addEvents: mockAddEvents,
    removeEvents: mockRemoveEvents,
    search: mockSearch,
    destroy: mockDestroy,
  })),
}));

// ── Collaborators that would otherwise open sockets or need providers ──────

let liveFeedOnEvent: ((event: TranslatedEvent) => void) | null = null;

vi.mock("@/lib/hooks/useLiveFeed", () => ({
  useLiveFeed: (onEvent: (event: TranslatedEvent) => void) => {
    // Capture the callback so a test can push an event through the same path
    // the WebSocket would.
    liveFeedOnEvent = onEvent;
    return {
      isLive: true,
      isPaused: false,
      newEventIds: new Set<string>(),
      connect: vi.fn(),
      disconnect: vi.fn(),
      togglePause: vi.fn(),
    };
  },
}));

vi.mock("@/lib/hooks/useLanguage", () => ({
  useLanguage: () => ({ language: "en", setLanguage: vi.fn() }),
}));

vi.mock("@/lib/hooks/useNetwork", () => ({
  useNetwork: () => ({ network: "testnet", setNetwork: vi.fn() }),
}));

vi.mock("@/lib/hooks/useDashboardPrefs", () => ({
  useDashboardPrefs: () => ({
    prefs: {
      favorites: [],
      columns: {
        timestamp: true,
        contract: true,
        description: true,
        status: true,
        tx: true,
      },
      density: "comfortable",
    },
    ready: true,
    update: vi.fn(),
    toggleColumn: vi.fn(),
    toggleFavorite: vi.fn(),
  }),
}));

vi.mock("@/lib/hooks/useEventFilters", () => ({
  useEventFilters: () => ({
    filters: {},
    // FilterBuilder reads rawParams for its uncontrolled inputs.
    rawParams: {
      contractId: "",
      eventType: "",
      minAmount: "",
      startLedger: "",
      endLedger: "",
    },
    setFilters: vi.fn(),
    clearAll: vi.fn(),
  }),
}));

const { DashboardClient } = await import("./DashboardClient");

// ── Fixtures ───────────────────────────────────────────────────────────────

function makeRawEvent(id: string, contractId = "CONTRACT_A"): RawEvent {
  return {
    id,
    contractId,
    topics: ["transfer"],
    data: "0x00",
    ledger: 1,
    timestamp: new Date("2026-01-01T00:00:00.000Z").toISOString(),
    txHash: `tx_${id}`,
  } as unknown as RawEvent;
}

function makeTranslatedEvent(id: string): TranslatedEvent {
  return {
    raw: makeRawEvent(id),
    status: "translated",
    eventType: "transfer",
    description: `Transferred tokens in ${id}`,
  } as unknown as TranslatedEvent;
}

const initialEvents = [makeRawEvent("evt_1"), makeRawEvent("evt_2")];

function renderDashboard() {
  return render(
    <DashboardClient initialEvents={initialEvents} usingMockData={false} />
  );
}

function searchBox(): HTMLInputElement {
  return screen.getByLabelText("Full-text event search") as HTMLInputElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  liveFeedOnEvent = null;
  mockSearch.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// ── Index lifecycle ────────────────────────────────────────────────────────

describe("dashboard search — index lifecycle", () => {
  it("builds the index once from the events already loaded", async () => {
    renderDashboard();

    expect(mockBuildIndex).toHaveBeenCalledTimes(1);
    const [indexedEvents] = mockBuildIndex.mock.calls[0];
    expect(indexedEvents).toHaveLength(initialEvents.length);
  });

  it("adds a streamed event incrementally instead of rebuilding", async () => {
    renderDashboard();
    expect(mockBuildIndex).toHaveBeenCalledTimes(1);

    await act(async () => {
      liveFeedOnEvent?.(makeTranslatedEvent("evt_live_1"));
    });

    // The whole point: one more ADD, still exactly one BUILD.
    expect(mockAddEvents).toHaveBeenCalledTimes(1);
    expect(mockBuildIndex).toHaveBeenCalledTimes(1);

    const [added] = mockAddEvents.mock.calls[0];
    expect(added).toHaveLength(1);
    expect(added[0].raw.id).toBe("evt_live_1");
  });

  it("only sends events the index has not already seen", async () => {
    renderDashboard();

    await act(async () => {
      liveFeedOnEvent?.(makeTranslatedEvent("evt_live_1"));
    });
    await act(async () => {
      liveFeedOnEvent?.(makeTranslatedEvent("evt_live_2"));
    });

    // Two arrivals, two single-event adds — the second call must not re-send
    // the first event, which a naive "diff the arrays" approach would do.
    expect(mockAddEvents).toHaveBeenCalledTimes(2);
    expect(mockAddEvents.mock.calls[1][0]).toHaveLength(1);
    expect(mockAddEvents.mock.calls[1][0][0].raw.id).toBe("evt_live_2");
  });

  it("never rebuilds the index as the feed grows", async () => {
    renderDashboard();

    for (let i = 0; i < 5; i++) {
      await act(async () => {
        liveFeedOnEvent?.(makeTranslatedEvent(`evt_stream_${i}`));
      });
    }

    expect(mockBuildIndex).toHaveBeenCalledTimes(1);
    expect(mockAddEvents).toHaveBeenCalledTimes(5);
  });
});

// ── Debouncing ─────────────────────────────────────────────────────────────

/**
 * Types `text` one character at a time, the way a user would.
 *
 * `fireEvent` rather than user-event: user-event's internal awaits deadlock
 * against `vi.useFakeTimers()`, and these tests exist specifically to control
 * the debounce clock.
 */
function typeQuery(text: string): void {
  let value = "";
  for (const char of text) {
    value += char;
    fireEvent.change(searchBox(), { target: { value } });
  }
}

describe("dashboard search — debouncing", () => {
  it("does not message the worker on every keystroke", async () => {
    vi.useFakeTimers();
    renderDashboard();

    typeQuery("transfer");

    // Eight keystrokes, and the debounce window has not elapsed.
    expect(mockSearch).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    // One search for the whole burst, carrying the final query.
    expect(mockSearch).toHaveBeenCalledTimes(1);
    expect(mockSearch.mock.calls[0][0]).toBe("transfer");
  });

  it("issues one search per settled query, not per character", async () => {
    vi.useFakeTimers();
    renderDashboard();

    typeQuery("abc");
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(mockSearch).toHaveBeenCalledTimes(1);

    typeQuery("abcdef");
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(mockSearch).toHaveBeenCalledTimes(2);
    expect(mockSearch.mock.calls[1][0]).toBe("abcdef");
  });

  it("clears results without messaging the worker when the box is emptied", async () => {
    vi.useFakeTimers();

    renderDashboard();
    typeQuery("a");
    fireEvent.change(searchBox(), { target: { value: "" } });

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    // An empty query is answered locally — no worker round-trip for it.
    expect(mockSearch).not.toHaveBeenCalled();
  });
});

// ── Results ────────────────────────────────────────────────────────────────

describe("dashboard search — results", () => {
  it("filters the feed to the hits the worker returned", async () => {
    vi.useFakeTimers();

    renderDashboard();
    const rowsBeforeSearch = screen.getAllByRole("row").length;

    // The worker scores evt_1 as a match and says nothing about evt_2.
    mockSearch.mockResolvedValue([{ id: "evt_1", score: 12 }]);

    typeQuery("transfer");
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    // One of the two event rows was filtered out by the worker's hits.
    expect(screen.getAllByRole("row").length).toBe(rowsBeforeSearch - 1);
  });

  it("restores the full feed once the query is cleared", async () => {
    vi.useFakeTimers();

    renderDashboard();
    const rowsBeforeSearch = screen.getAllByRole("row").length;

    mockSearch.mockResolvedValue([{ id: "evt_1", score: 12 }]);
    typeQuery("transfer");
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getAllByRole("row").length).toBe(rowsBeforeSearch - 1);

    fireEvent.change(searchBox(), { target: { value: "" } });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(screen.getAllByRole("row").length).toBe(rowsBeforeSearch);
  });

  it("passes the query through to the worker unchanged", async () => {
    vi.useFakeTimers();

    renderDashboard();
    typeQuery("Transfer(");
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    // Ranking and tokenization are the worker's business — the component must
    // not pre-process the query.
    expect(mockSearch.mock.calls[0][0]).toBe("Transfer(");
  });
});

// ── Worker lifecycle ───────────────────────────────────────────────────────

describe("dashboard search — worker lifecycle", () => {
  it("terminates the worker on unmount", async () => {
    const { unmount } = renderDashboard();
    expect(mockDestroy).not.toHaveBeenCalled();

    unmount();

    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });

  it("leaks no worker across repeated mount/unmount cycles", async () => {
    // The bug class this guards: one orphaned worker per remount, which only
    // shows up after navigating back and forth a few times.
    for (let i = 0; i < 3; i++) {
      const { unmount } = renderDashboard();
      unmount();
    }

    expect(mockDestroy).toHaveBeenCalledTimes(3);
  });

  it("surfaces a worker search failure instead of hanging", async () => {
    vi.useFakeTimers();

    mockSearch.mockRejectedValue(new Error("worker exploded"));

    renderDashboard();
    typeQuery("boom");
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    // queryByText, not findByText: the latter polls on real timers and would
    // deadlock against the fake clock this test installs.
    expect(screen.queryByText("worker exploded")).toBeTruthy();
  });
});
