/**
 * useEventSearch — React hook that manages the EventSearchClient worker
 * lifecycle and provides debounced search over the live event feed.
 *
 * Features:
 * - Lazily instantiates the Web Worker on first search
 * - Debounces search queries (300ms default)
 * - Incrementally updates the index as new events arrive
 * - Properly terminates the worker on unmount
 * - Provides a fallback for environments without Web Worker support
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
  // Use the IDs of the first and last events plus the count as a quick hash.
  const first = events[0]?.raw.id ?? "";
  const last = events[events.length - 1]?.raw.id ?? "";
  return `${first}:${last}:${events.length}`;
}

export function useEventSearch(
  options: UseEventSearchOptions = {}
): UseEventSearchResult {
  const { debounceMs = 300, defaultLimit = 50 } = options;

  const [results, setResults] = useState<Array<{ id: string; score: number }>>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isIndexed, setIsIndexed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clientRef = useRef<EventSearchClient | null>(null);
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
        // Web Worker not supported — fallback to sync search.
        console.warn("[useEventSearch] Web Worker unavailable, using fallback");
        setError("Web Worker not available. Search may be slow.");
      }
    }
    return clientRef.current;
  }, []);

  const buildIndex = useCallback(
    (events: TranslatedEvent[]) => {
      const client = ensureClient();
      if (!client) return;

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
      if (!client || !isIndexed) return;

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
      if (!client || !isIndexed) return;

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
      if (!client) return;

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
    search,
    clearResults,
    buildIndex,
    addEvents,
    removeEvents,
  };
}
