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

/**
 * Manages a WebSocket connection for the live event feed.
 *
 * @param onEvent - Called with each new TranslatedEvent when live & not paused.
 */
export function useLiveFeed(onEvent: (event: TranslatedEvent) => void): LiveFeedState {
  const [isLive, setIsLive] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [newEventIds, setNewEventIds] = useState<Set<string>>(new Set());

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pauseBufferRef = useRef<TranslatedEvent[]>([]);
  const isPausedRef = useRef(false);
  const isEnabledRef = useRef(false);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const connect = useCallback(() => {
    if (wsRef.current || !isEnabledRef.current) return;

    console.log("[useLiveFeed] Connecting to WebSocket...");
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("[useLiveFeed] WebSocket connected");
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };

    ws.onmessage = (e: MessageEvent) => {
      try {
        const event = JSON.parse(e.data as string) as TranslatedEvent;

        if (isPausedRef.current) {
          pauseBufferRef.current.push(event);
          return;
        }

        onEventRef.current(event);
        setNewEventIds((prev) => new Set(prev).add(event.raw.id));
        // Remove highlight after animation completes (600 ms).
        setTimeout(() => {
          setNewEventIds((prev) => {
            const next = new Set(prev);
            next.delete(event.raw.id);
            return next;
          });
        }, 600);
      } catch (err) {
        console.error("[useLiveFeed] Error parsing message:", err);
      }
    };

    ws.onclose = (event) => {
      console.log(`[useLiveFeed] WebSocket closed (code: ${event.code})`);
      wsRef.current = null;

      // Auto-reconnect if it wasn't an intentional disconnect
      if (isEnabledRef.current) {
        console.log("[useLiveFeed] Attempting to reconnect in 3s...");
        reconnectTimeoutRef.current = setTimeout(connect, 3000);
      }
    };

    ws.onerror = (err) => {
      console.error("[useLiveFeed] WebSocket error:", err);
      ws.close();
    };
  }, []);

  const disconnect = useCallback(() => {
    isEnabledRef.current = false;
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    pauseBufferRef.current = [];
  }, []);

  const toggleLive = useCallback(() => {
    setIsLive((prev) => {
      if (prev) {
        disconnect();
        setIsPaused(false);
        isPausedRef.current = false;
      } else {
        isEnabledRef.current = true;
        connect();
      }
      return !prev;
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
          setTimeout(() => {
            setNewEventIds((ids) => {
              const next = new Set(ids);
              next.delete(event.raw.id);
              return next;
            });
          }, 600);
        }
      }

      return !prev;
    });
  }, []);

  // Clean up on unmount.
  useEffect(() => {
    return disconnect;
  }, [disconnect]);

  return { isLive, isPaused, newEventIds, toggleLive, togglePause };
}
