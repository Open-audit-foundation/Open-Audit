/**
 * useBridgeMatches — fetches and auto-refreshes cross-chain match data.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { CrossChainJourney } from "@/lib/bridge/types";

interface UseBridgeMatchesOptions {
  status?: string;
  chain?: string;
  limit?: number;
  /** Refresh interval in ms. 0 = no auto-refresh. Default 15 000. */
  refreshIntervalMs?: number;
}

interface UseBridgeMatchesResult {
  matches: CrossChainJourney[];
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
  hasMore: boolean;
  loadMore: () => void;
}

export function useBridgeMatches(
  opts: UseBridgeMatchesOptions = {}
): UseBridgeMatchesResult {
  const {
    status,
    chain,
    limit = 25,
    refreshIntervalMs = 15_000,
  } = opts;

  const [matches, setMatches] = useState<CrossChainJourney[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const buildUrl = useCallback(
    (paginationCursor?: string | null) => {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (chain)  params.set("chain", chain);
      params.set("limit", String(limit));
      if (paginationCursor) params.set("cursor", paginationCursor);
      return `/api/v1/bridge/matches?${params.toString()}`;
    },
    [status, chain, limit]
  );

  const fetchMatches = useCallback(
    async (append = false) => {
      setIsLoading(true);
      setError(null);
      try {
        const url = buildUrl(append ? cursor : null);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as {
          data: CrossChainJourney[];
          pagination: { nextCursor: string | null; hasMore: boolean };
        };
        setMatches((prev) =>
          append ? [...prev, ...json.data] : json.data
        );
        setCursor(json.pagination.nextCursor);
        setHasMore(json.pagination.hasMore);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setIsLoading(false);
      }
    },
    [buildUrl, cursor]
  );

  // Initial load + reset on filter change
  useEffect(() => {
    setMatches([]);
    setCursor(null);
    fetchMatches(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, chain, limit]);

  // Auto-refresh
  useEffect(() => {
    if (refreshIntervalMs > 0) {
      timerRef.current = setInterval(() => fetchMatches(false), refreshIntervalMs);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshIntervalMs, status, chain, limit]);

  return {
    matches,
    isLoading,
    error,
    refresh: () => fetchMatches(false),
    hasMore,
    loadMore: () => fetchMatches(true),
  };
}
