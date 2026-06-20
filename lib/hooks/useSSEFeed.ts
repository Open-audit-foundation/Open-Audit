"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TranslatedEvent } from "../translator/types";

interface SSEFilter {
  contractId?: string;
  search?: string;
}

interface SSEFeedState {
  isLive: boolean;
  toggleLive: () => void;
}

/**
 * Connects to the SSE endpoint at /api/v1/events/stream.
 *
 * @param onEvent  – called with each incoming TranslatedEvent
 * @param filter   – optional contract_id / search filter forwarded as query params
 */
export function useSSEFeed(
  onEvent: (event: TranslatedEvent) => void,
  filter: SSEFilter = {}
): SSEFeedState {
  const [isLive, setIsLive] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const buildUrl = useCallback(() => {
    const params = new URLSearchParams();
    if (filter.contractId) params.set("contract_id", filter.contractId);
    if (filter.search) params.set("search", filter.search);
    const qs = params.toString();
    return `/api/v1/events/stream${qs ? `?${qs}` : ""}`;
  }, [filter.contractId, filter.search]);

  const connect = useCallback(() => {
    if (esRef.current) return;
    const es = new EventSource(buildUrl());
    esRef.current = es;

    es.onmessage = (e: MessageEvent<string>) => {
      const event = JSON.parse(e.data) as TranslatedEvent;
      onEventRef.current(event);
    };

    es.onerror = () => {
      // EventSource handles reconnection automatically.
      // Errors here are transient; state stays live.
    };
  }, [buildUrl]);

  const disconnect = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
  }, []);

  const toggleLive = useCallback(() => {
    setIsLive((prev) => {
      if (prev) {
        disconnect();
      } else {
        connect();
      }
      return !prev;
    });
  }, [connect, disconnect]);

  // Cleanup on unmount.
  useEffect(() => () => disconnect(), [disconnect]);

  return { isLive, toggleLive };
}
