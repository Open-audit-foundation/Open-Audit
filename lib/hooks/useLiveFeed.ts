import { useCallback, useEffect, useRef, useState } from "react";
import type { TranslatedEvent } from "../translator/types";

export interface LiveFeedState {
  isLive: boolean;
  isPaused: boolean;
  newEventIds: Set<string>;
  toggleLive: () => void;
  togglePause: () => void;
}

const WS_URL =
  typeof window !== "undefined"
    ? `ws://${window.location.host}/ws/events`
    : "";

// ---------------------------------------------------------------------------
// Reconnection backoff constants
// ---------------------------------------------------------------------------
/** Initial delay before the first reconnection attempt (ms). */
const BACKOFF_BASE_MS = 1_000;
/** Exponential growth factor applied on each successive attempt. */
const BACKOFF_MULTIPLIER = 2;
/** Hard ceiling on any single backoff interval (ms). */
const BACKOFF_MAX_MS = 30_000;

/**
 * Computes a "full jitter" backoff delay for the given attempt number.
 *
 * Formula:
 *   cappedDelay = min(BASE × MULTIPLIER^attempt, MAX)
 *   finalDelay  = RandomBetween(0, cappedDelay)
 *
 * Full jitter ensures that a fleet of simultaneously-disconnected clients
 * spreads their reconnection attempts uniformly across [0, cappedDelay],
 * preventing the "thundering herd" problem on server restarts.
 */
function computeBackoffDelay(attempt: number): number {
  const cappedDelay = Math.min(
    BACKOFF_BASE_MS * Math.pow(BACKOFF_MULTIPLIER, attempt),
    BACKOFF_MAX_MS
  );
  return Math.random() * cappedDelay;
}

/**
 * Manages a WebSocket connection for the live event feed with exponential
 * backoff and full-jitter reconnection on unexpected disconnections.
 *
 * @param onEvent - Called with each new TranslatedEvent when live & not paused.
 */
export function useLiveFeed(onEvent: (event: TranslatedEvent) => void): LiveFeedState {
  const [isLive, setIsLive] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [newEventIds, setNewEventIds] = useState<Set<string>>(new Set());

  const wsRef = useRef<WebSocket | null>(null);
  const pauseBufferRef = useRef<TranslatedEvent[]>([]);
  const isPausedRef = useRef(false);
  const onEventRef = useRef(onEvent);
  const timeoutIdsRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  onEventRef.current = onEvent;

  // Tracks the current reconnection attempt count. Reset to 0 on a successful
  // open so the next disconnect starts the backoff sequence from scratch.
  const attemptRef = useRef(0);

  // Holds the pending setTimeout handle for the next reconnection attempt so
  // it can be cancelled if the user manually stops the live feed.
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // isLiveRef mirrors the isLive state so the onclose handler (a stale closure)
  // can read the current "live" flag without needing to be recreated every render.
  const isLiveRef = useRef(false);

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /** Cancels any pending reconnection timer. */
  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  /** Tears down the current socket and clears ancillary state. */
  const closeSocket = useCallback(() => {
    clearReconnectTimer();
    if (wsRef.current) {
      // Remove the onclose handler before calling close() so the close event
      // doesn't trigger a reconnection attempt after an intentional disconnect.
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    pauseBufferRef.current = [];
  }, [clearReconnectTimer]);

  // ---------------------------------------------------------------------------
  // Core connect function
  // ---------------------------------------------------------------------------

  /**
   * Opens a new WebSocket connection.  On success the attempt counter resets.
   * On unexpected close (i.e. while isLive is still true) a reconnection is
   * scheduled using the current attempt count before incrementing it.
   */
  const connect = useCallback(() => {
    // Guard: do not open a second socket if one is already live.
    if (wsRef.current !== null) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      // Successful handshake — reset the backoff counter.
      attemptRef.current = 0;
    };

    ws.onmessage = (e: MessageEvent) => {
      const event = JSON.parse(e.data as string) as TranslatedEvent;

      if (isPausedRef.current) {
        pauseBufferRef.current.push(event);
        return;
      }

      onEventRef.current(event);
      setNewEventIds((prev) => new Set(prev).add(event.raw.id));

      // Remove the highlight badge after the animation completes (600 ms).
      // `timeoutId` is declared with `let` (rather than `const`) so it can be
      // referenced inside the setTimeout callback closure before the
      // assignment below has completed — using `const` here would leave the
      // callback capturing a binding that is still in the temporal dead zone
      // when the timer fires, throwing a ReferenceError.
      let timeoutId: ReturnType<typeof setTimeout>;
      timeoutId = setTimeout(() => {
        setNewEventIds((prev) => {
          const next = new Set(prev);
          next.delete(event.raw.id);
          return next;
        });
        timeoutIdsRef.current.delete(timeoutId);
      }, 600);
      timeoutIdsRef.current.add(timeoutId);
    };

    ws.onclose = () => {
      wsRef.current = null;

      // Only schedule a reconnect if the feed is still supposed to be live.
      if (!isLiveRef.current) return;

      const delay = computeBackoffDelay(attemptRef.current);
      attemptRef.current += 1;

      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        // Re-check the live flag after the timer fires in case the user
        // disabled the feed while the timer was pending.
        if (isLiveRef.current) {
          connect();
        }
      }, delay);
    };
  }, []); // No deps — relies only on refs so this function is stable.

  // ---------------------------------------------------------------------------
  // Public controls
  // ---------------------------------------------------------------------------

  const disconnect = useCallback(() => {
    closeSocket();
    attemptRef.current = 0;
  }, [closeSocket]);

  const toggleLive = useCallback(() => {
    setIsLive((prev) => {
      const nextLive = !prev;
      isLiveRef.current = nextLive;

      if (prev) {
        // Turning off — tear everything down cleanly.
        disconnect();
        setIsPaused(false);
        isPausedRef.current = false;
      } else {
        // Turning on — open a fresh connection.
        connect();
      }

      return nextLive;
    });
  }, [connect, disconnect]);

  const togglePause = useCallback(() => {
    setIsPaused((prev) => {
      isPausedRef.current = !prev;

      // Flush buffered events when unpausing.
      if (prev) {
        const buffered = pauseBufferRef.current.splice(0);
        for (const event of buffered) {
          onEventRef.current(event);
          setNewEventIds((ids) => new Set(ids).add(event.raw.id));
          const timeoutId = setTimeout(() => {
            setNewEventIds((ids) => {
              const next = new Set(ids);
              next.delete(event.raw.id);
              return next;
            });
            timeoutIdsRef.current.delete(timeoutId);
          }, 600);
          timeoutIdsRef.current.add(timeoutId);
        }
      }

      return !prev;
    });
  }, []);

  // ---------------------------------------------------------------------------
  // Clean up on unmount
  // ---------------------------------------------------------------------------
  useEffect(() => {
    return () => {
      isLiveRef.current = false;
      disconnect();
    };
  }, [disconnect]);

  return { isLive, isPaused, newEventIds, toggleLive, togglePause };
}
