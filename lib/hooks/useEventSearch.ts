/**
 * useEventSearch — React hook that manages the EventSearchClient worker
 * lifecycle and provides debounced search over the live event feed.
 *
 * Features:
 * - Lazily instantiates the Web Worker on first search
 * - Debounces search queries (300ms default)
 * - Incrementally updates the index as new events arrive
 * - Properly terminates the worker on unmount
 * - Provides a synchronous main-thread fallback when Web Workers are unavailable
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { EventSearchClient } from "../workers/eventSearchClient";
import type { TranslatedEvent } from "../translator/types";

export interface UseEventSearchOptions {
  /** Debounce delay in milliseconds. Default: 300 */
  debounceMs?: number;
  /** Maximum search results. Default: 50 */
  defaultLimit?: number;
}

export interface UseEventSearchResult {
  /** Search results matching the current query. */
  results: Array<{ id: string; score: number }>;
  /** Whether a search is currently in progress. */
  isSearching: boolean;
  /** Whether the search index is built and ready. */
  isIndexed: boolean;
  /** Error message if the search worker failed. */
  error: string | null;
  /** Whether the search is running on the main thread (no Web Worker). */
  isFallback: boolean;
  /** Execute a search query. Results arrive asynchronously. */
  search: (query: string, opts?: { contractId?: string; limit?: number }) => void;
  /** Clear current search results. */
  clearResults: () => void;
  /** Build or rebuild the search index from the given events. */
  buildIndex: (events: TranslatedEvent[]) => void;
  /** Incrementally add new events to the index. */
  addEvents: (events: TranslatedEvent[]) => void;
  /** Remove events from the index by ID. */
  removeEvents: (eventIds: string[]) => void;
}

function computeEventsHash(events: TranslatedEvent[]): string {
  if (events.length === 0) return "empty";
  const first = events[0]?.raw.id ?? "";
  const last = events[events.length - 1]?.raw.id ?? "";
  return `${first}:${last}:${events.length}`;
}

/**
 * Simple main-thread search fallback for environments without Web Worker support.
 * Does a basic case-insensitive substring match over the description field.
 */
function syncSearch(
  events: TranslatedEvent[],
  query: string,
  opts: { contractId?: string; limit?: number } = {}
): Array<{ id: string; score: number }> {
  const q = query.toLowerCase();
  const limit = opts.limit ?? 50;
  const results: Array<{ id: string; score: number }> = [];

  for (const event of events) {
    if (opts.contractId && event.raw.contractId !== opts.contractId) continue;

    const desc = (event.description ?? "").toLowerCase();
    const fnName = (event.eventType ?? "").toLowerCase();
    const contractId = (event.raw.contractId ?? "").toLowerCase();

    let score = 0;
    if (desc.includes(q)) score += 10;
    if (fnName.includes(q)) score += 5;
    if (contractId.includes(q)) score += 3;

    if (score > 0) {
      results.push({ id: event.raw.id, score });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

export function useEventSearch(
  options: UseEventSearchOptions = {}
): UseEventSearchResult {
  const { debounceMs = 300, defaultLimit = 50 } = options;

  const [results, setResults] = useState<Array<{ id: string; score: number }>>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isIndexed, setIsIndexed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isFallback, setIsFallback] = useState(false);

  const clientRef = useRef<EventSearchClient | null>(null);
  const fallbackEventsRef = useRef<TranslatedEvent[]>([]);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  // Cleanup on unmount.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      clientRef.current?.destroy();
      clientRef.current = null;
    };
  }, []);

  const ensureClient = useCallback(() => {
    if (!clientRef.current) {
      try {
        clientRef.current = new EventSearchClient();
      } catch (err) {
        // Web Worker not supported — fall back to synchronous main-thread search.
        console.warn(
          "[useEventSearch] Web Worker unavailable, falling back to main-thread search"
        );
        setIsFallback(true);
        setError(null);
      }
    }
    return clientRef.current;
  }, []);

  const buildIndex = useCallback(
    (events: TranslatedEvent[]) => {
      const client = ensureClient();
      fallbackEventsRef.current = events;

      if (!client) {
        // Fallback mode: mark as indexed immediately.
        if (mountedRef.current) {
          setIsIndexed(true);
          setError(null);
        }
        return;
      }

      const hash = computeEventsHash(events);
      client
        .buildIndex(events, hash)
        .then(() => {
          if (mountedRef.current) {
            setIsIndexed(true);
            setError(null);
          }
        })
        .catch((err) => {
          if (mountedRef.current) {
            setError(err instanceof Error ? err.message : "Failed to build index");
          }
        });
    },
    [ensureClient]
  );

  const addEvents = useCallback(
    (events: TranslatedEvent[]) => {
      const client = ensureClient();

      if (!client) {
        // Fallback: append to the local events list.
        fallbackEventsRef.current = [...fallbackEventsRef.current, ...events];
        return;
      }

      if (!isIndexed) return;

      client
        .addEvents(events)
        .catch((err) => {
          if (mountedRef.current) {
            console.error("[useEventSearch] Failed to add events:", err);
          }
        });
    },
    [ensureClient, isIndexed]
  );

  const removeEvents = useCallback(
    (eventIds: string[]) => {
      const client = ensureClient();

      if (!client) {
        const idSet = new Set(eventIds);
        fallbackEventsRef.current = fallbackEventsRef.current.filter(
          (e) => !idSet.has(e.raw.id)
        );
        return;
      }

      if (!isIndexed) return;

      client
        .removeEvents(eventIds)
        .catch((err) => {
          if (mountedRef.current) {
            console.error("[useEventSearch] Failed to remove events:", err);
          }
        });
    },
    [ensureClient, isIndexed]
  );

  const search = useCallback(
    (query: string, opts?: { contractId?: string; limit?: number }) => {
      const client = ensureClient();

      // Clear any pending debounced search.
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      if (!query.trim()) {
        setResults([]);
        setIsSearching(false);
        return;
      }

      setIsSearching(true);

      debounceTimerRef.current = setTimeout(() => {
        if (!client) {
          // Synchronous fallback: search on main thread.
          const hits = syncSearch(fallbackEventsRef.current, query, {
            limit: defaultLimit,
            ...opts,
          });
          if (mountedRef.current) {
            setResults(hits);
            setIsSearching(false);
          }
          return;
        }

        client
          .search(query, { limit: defaultLimit, ...opts })
          .then((hits) => {
            if (mountedRef.current) {
              setResults(hits);
              setIsSearching(false);
            }
          })
          .catch((err) => {
            if (mountedRef.current) {
              setError(err instanceof Error ? err.message : "Search failed");
              setIsSearching(false);
            }
          });
      }, debounceMs);
    },
    [ensureClient, debounceMs, defaultLimit]
  );

  const clearResults = useCallback(() => {
    setResults([]);
    setIsSearching(false);
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
  }, []);

  return {
    results,
    isSearching,
    isIndexed,
    error,
    isFallback,
    search,
    clearResults,
    buildIndex,
    addEvents,
    removeEvents,
  };
}
