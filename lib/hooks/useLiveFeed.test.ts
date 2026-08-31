import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useLiveFeed } from "./useLiveFeed";
import type { TranslatedEvent } from "../translator/types";

/**
 * Minimal WebSocket stand-in that lets tests drive `onopen`/`onmessage`
 * manually instead of spinning up a real socket/server.
 */
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static OPEN = 1;

  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }

  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}

function makeEvent(id: string): TranslatedEvent {
  return {
    raw: {
      id,
      contractId: "CABC",
      topics: [],
      data: "0x00",
      ledger: 1,
      timestamp: Date.now(),
      txHash: "tx1",
    },
    description: "Test transfer",
    status: "translated",
    blueprintName: "Test Blueprint",
    eventType: "Transfer",
    schemaVersion: null,
  };
}

/** Renders the hook, turns the live feed on, and returns the mock socket it opened. */
function connectSocket() {
  const onEvent = vi.fn();
  const { result } = renderHook(() => useLiveFeed(onEvent));

  act(() => {
    result.current.toggleLive();
  });

  const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
  act(() => {
    ws.onopen?.();
  });

  return { result, ws, onEvent };
}

describe("useLiveFeed", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not throw a ReferenceError when a live event is received (regression for #289)", () => {
    const { ws } = connectSocket();
    const event = makeEvent("evt-1");

    expect(() => {
      act(() => {
        ws.onmessage?.({ data: JSON.stringify(event) });
      });
    }).not.toThrow();
  });

  it("forwards the parsed event to the onEvent callback and highlights it immediately", () => {
    const { ws, result, onEvent } = connectSocket();
    const event = makeEvent("evt-2");

    act(() => {
      ws.onmessage?.({ data: JSON.stringify(event) });
    });

    expect(onEvent).toHaveBeenCalledWith(event);
    expect(result.current.newEventIds.has("evt-2")).toBe(true);
  });

  it("removes the highlight id once the 600ms animation window elapses", () => {
    const { ws, result } = connectSocket();
    const event = makeEvent("evt-3");

    act(() => {
      ws.onmessage?.({ data: JSON.stringify(event) });
    });
    expect(result.current.newEventIds.has("evt-3")).toBe(true);

    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(result.current.newEventIds.has("evt-3")).toBe(false);
  });

  it("tracks concurrent highlight timers independently for multiple events", () => {
    const { ws, result } = connectSocket();
    const eventA = makeEvent("evt-a");
    const eventB = makeEvent("evt-b");

    act(() => {
      ws.onmessage?.({ data: JSON.stringify(eventA) });
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    act(() => {
      ws.onmessage?.({ data: JSON.stringify(eventB) });
    });

    // eventA's 600ms timer has only had 300ms elapse; both should still be highlighted.
    expect(result.current.newEventIds.has("evt-a")).toBe(true);
    expect(result.current.newEventIds.has("evt-b")).toBe(true);

    act(() => {
      vi.advanceTimersByTime(300);
    });
    // eventA's timer (600ms total) has now fired; eventB's (300ms elapsed) has not.
    expect(result.current.newEventIds.has("evt-a")).toBe(false);
    expect(result.current.newEventIds.has("evt-b")).toBe(true);

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current.newEventIds.has("evt-b")).toBe(false);
  });
});
