
"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import {
  AlertCircle,
  BookOpen,
  ArrowRight,
  Radio,
  PauseCircle,
  PlayCircle,
  Upload,
  FileJson,
  Trash2,
  Download,
  Star,
  Search,
} from "lucide-react";
import { SearchBar } from "@/components/dashboard/SearchBar";
import { FilterBuilder } from "@/components/dashboard/FilterBuilder";
import { EventFeedTable } from "@/components/dashboard/EventFeedTable";
import { StatsBar } from "@/components/dashboard/StatsBar";
import { FavoritesSidebar } from "@/components/dashboard/FavoritesSidebar";
import { UploadAbiDialog } from "@/components/dashboard/UploadAbiDialog";
import { ExportDataDialog } from "@/components/dashboard/ExportDataDialog";
import { Button } from "@/components/ui/button";
import { useLiveFeed } from "@/lib/hooks/useLiveFeed";
import { useLanguage } from "@/lib/hooks/useLanguage";
import { useNetwork } from "@/lib/hooks/useNetwork";
import { useDashboardPrefs } from "@/lib/hooks/useDashboardPrefs";
import { useEventFilters } from "@/lib/hooks/useEventFilters";
import { useEventSearch } from "@/lib/hooks/useEventSearch";
import {
  buildCustomBlueprints,
  loadCustomAbis,
  removeCustomAbi,
  saveCustomAbi,
} from "@/lib/translator/custom-abi";
import type { TranslatedEvent, RawEvent, CustomAbi } from "@/lib/translator/types";
import { translateEvents } from "@/lib/translator/registry";

interface DashboardClientProps {
  /** Events fetched server-side (from the database, or mock data as a fallback). */
  initialEvents: RawEvent[];
  /** True when initialEvents is mock data because DATABASE_URL isn't configured. */
  usingMockData: boolean;
}

export function DashboardClient({
  initialEvents,
  usingMockData,
}: DashboardClientProps): React.JSX.Element {
  const [rawEvents] = useState<RawEvent[]>(initialEvents);
  const [liveEvents, setLiveEvents] = useState<TranslatedEvent[]>([]);
  const [customAbis, setCustomAbis] = useState<CustomAbi[]>([]);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [searchedContract, setSearchedContract] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<RawEvent[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Client-side full-text search via Web Worker.
  const {
    results: searchHits,
    isSearching,
    isIndexed,
    error: searchError,
    search: clientSearch,
    clearResults: clearClientSearch,
    buildIndex,
    addEvents: addSearchEvents,
  } = useEventSearch({ debounceMs: 300 });

  const { language } = useLanguage();
  const { network } = useNetwork();
  const { prefs, ready, update, toggleColumn, toggleFavorite } =
    useDashboardPrefs();
  const { filters, setFilters } = useEventFilters();

  useEffect(() => {
    setCustomAbis(loadCustomAbis());
  }, []);

  const customBlueprints = useMemo(
    () => buildCustomBlueprints(customAbis),
    [customAbis]
  );

  // When a contract search is active, its API results replace the initially
  // fetched event list; clearing the search falls back to that initial list.
  const sourceEvents = searchResults ?? rawEvents;

  // Derive translations from the raw events + current custom blueprints so the
  // feed re-translates instantly when an ABI is uploaded or removed.
  const translatedRawEvents = useMemo(
    function () {
      return translateEvents(sourceEvents, customBlueprints);
    },
    [sourceEvents, customBlueprints]
  );

  // Merge live-streamed events (prepended) with the translated batch.
  const allEvents = useMemo(
    function () {
      return [...liveEvents, ...translatedRawEvents];
    },
    [liveEvents, translatedRawEvents]
  );

  // Build the search index when allEvents change.
  const allEventsRef = useRef(allEvents);
  allEventsRef.current = allEvents;
  const indexBuiltRef = useRef(false);

  useEffect(() => {
    if (allEvents.length > 0) {
      if (!indexBuiltRef.current) {
        buildIndex(allEvents);
        indexBuiltRef.current = true;
      } else {
        // Incrementally add new events that aren't already indexed.
        const newEvents = allEvents.filter(
          (e) => !liveEvents.includes(e) || liveEvents.indexOf(e) === allEvents.indexOf(e)
        );
        if (newEvents.length > 0 && newEvents.length < allEvents.length) {
          addSearchEvents(newEvents.slice(0, Math.min(20, newEvents.length)));
        }
      }
    }
  }, [allEvents, buildIndex, addSearchEvents, liveEvents]);

  // When client search hits come back, filter the event list to show only matches.
  const filteredEvents = useMemo(() => {
    let events = allEvents;

    // Apply client-side search filter if there are search hits and a query is active.
    if (searchHits.length > 0 && searchValue) {
      const hitIds = new Set(searchHits.map((h) => h.id));
      events = events.filter((event) => hitIds.has(event.raw.id));
    }

    return events.filter((event) => {
      if (filters.contractId && event.raw.contractId !== filters.contractId) {
        return false;
      }

      if (filters.eventType) {
        const normalizedEventType = filters.eventType.toLowerCase();
        const translatedType = event.eventType?.toLowerCase() ?? "";
        if (!translatedType.includes(normalizedEventType)) {
          return false;
        }
      }

      if (filters.minAmount !== undefined) {
        const amount = Number(
          event.raw.data
            ? BigInt("0x" + event.raw.data.slice(2).replace(/[^0-9a-fA-F]/g, "0"))
            : 0n
        );
        if (Number(amount) < filters.minAmount) {
          return false;
        }
      }

      if (
        filters.startLedger !== undefined &&
        event.raw.ledger < filters.startLedger
      ) {
        return false;
      }

      if (
        filters.endLedger !== undefined &&
        event.raw.ledger > filters.endLedger
      ) {
        return false;
      }

      return true;
    });
  }, [allEvents, searchHits, searchValue, filters]);

  const handleNewEvent = useCallback(
    (event: TranslatedEvent): void => {
      if (filters.contractId && event.raw.contractId !== filters.contractId) return;
      setLiveEvents((prev) => [event, ...prev]);
      // Incrementally add the new event to the search index.
      addSearchEvents([event]);
    },
    [filters.contractId, addSearchEvents]
  );

  const handleSearch = useCallback(
    async function (contractId: string): Promise<void> {
      const normalized = contractId.trim();
      setSearchValue(normalized);
      setSearchedContract(normalized || null);
      setFilters({ contractId: normalized });

      if (!normalized) {
        setSearchResults(null);
        setError(null);
        clearClientSearch();
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const res = await fetch("/api/v1/events/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contractId: normalized }),
        });
        if (!res.ok) {
          throw new Error(`Search failed: ${res.statusText}`);
        }
        const data: { events: RawEvent[] } = await res.json();
        setSearchResults(
          data.events.map((event) => ({
            id: event.id,
            contractId: event.contractId,
            topics: event.topics,
            data: event.data,
            ledger: event.ledger,
            timestamp: event.timestamp,
            txHash: event.txHash,
          }))
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "An unknown error occurred");
        setSearchResults(null);
      } finally {
        setIsLoading(false);
      }
    },
    [setFilters, clearClientSearch]
  );

  // Client-side full-text search handler (separate from contract ID search).
  const handleClientSearch = useCallback(
    function (query: string): void {
      setSearchValue(query);
      if (!query.trim()) {
        clearClientSearch();
        return;
      }
      clientSearch(query);
    },
    [clientSearch, clearClientSearch]
  );

  const { isLive, isPaused, newEventIds, toggleLive, togglePause } =
    useLiveFeed(handleNewEvent);

  const handleAbiUpload = useCallback((abi: CustomAbi): void => {
    setCustomAbis(saveCustomAbi(abi));
    setIsUploadOpen(false);
  }, []);

  const handleAbiRemove = useCallback((contractId: string): void => {
    setCustomAbis(removeCustomAbi(contractId));
  }, []);

  const handleFavoriteSelect = useCallback(
    (contractId: string): void => {
      setFilters({ contractId });
    },
    [setFilters]
  );

  const isFavorited = filters.contractId
    ? prefs.favorites.includes(filters.contractId)
    : false;

  const MockDataBanner = () => (
    <div
      role="status"
      className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-300"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <p>
        Showing sample data — <code>DATABASE_URL</code> is not configured, so events
        can&apos;t be loaded from the database.
      </p>
    </div>
  );

  return (
    <div className="space-y-6">
      {ready && (
        <FavoritesSidebar
          favorites={prefs.favorites}
          activeContract={filters.contractId}
          onSelect={handleFavoriteSelect}
          onRemove={toggleFavorite}
        />
      )}

      <section aria-label="Event filters">
        <div className="flex flex-col gap-3">
          {/* Server-side contract ID search */}
          <SearchBar
            onSearch={handleSearch}
            isLoading={isLoading}
            defaultValue={searchValue}
          />

          {/* Client-side full-text search input */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              placeholder="Full-text search events (powered by Web Worker)..."
              value={searchValue}
              onChange={(e) => handleClientSearch(e.target.value)}
              className="h-10 w-full rounded-lg border bg-background pl-9 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-ring font-mono"
              aria-label="Full-text event search"
            />
            {isSearching && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              </div>
            )}
          </div>
          {searchError && (
            <p className="text-xs text-destructive">{searchError}</p>
          )}

          <FilterBuilder
            eventTypeSuggestions={Array.from(
              new Set(
                allEvents
                  .map((event) => event.eventType)
                  .filter((value): value is string => Boolean(value))
              )
            )}
            contractSuggestions={Array.from(
              new Set(allEvents.map((event) => event.raw.contractId))
            )}
          />

          {filters.contractId && (
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="mt-0.5 h-9 w-9 shrink-0"
                onClick={() => toggleFavorite(filters.contractId)}
                aria-label={isFavorited ? "Unpin this contract" : "Pin this contract"}
                title={isFavorited ? "Unpin contract" : "Pin contract"}
              >
                <Star
                  className={`h-4 w-4 transition-colors ${
                    isFavorited
                      ? "fill-amber-400 text-amber-400"
                      : "text-muted-foreground"
                  }`}
                />
              </Button>
              <span className="text-sm text-muted-foreground">
                Filtered contract is pinned / unpinned by toggle.
              </span>
            </div>
          )}
        </div>
      </section>

      {usingMockData && <MockDataBanner />}

      <section aria-label="Custom ABIs" className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setIsUploadOpen(true)}>
          <Upload className="mr-2 h-4 w-4" />
          Upload Custom ABI
        </Button>

        {customAbis.map((abi) => (
          <span
            key={abi.contractId}
            className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 py-1 pl-2.5 pr-1.5 text-xs"
            title={abi.contractId}
          >
            <FileJson className="h-3.5 w-3.5 text-violet-500" />
            <span className="font-medium">{abi.contractName}</span>
            <button
              type="button"
              onClick={() => handleAbiRemove(abi.contractId)}
              className="text-muted-foreground transition-colors hover:text-destructive"
              aria-label={`Remove custom ABI for ${abi.contractName}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </span>
        ))}
      </section>

      <StatsBar events={allEvents} />

      <section aria-label="Event feed">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            Event Feed
          </h2>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-3 text-xs border-violet-300 text-violet-700 hover:bg-violet-50 dark:border-violet-700 dark:text-violet-400 dark:hover:bg-violet-950"
              onClick={() => setIsExportOpen(true)}
              disabled={allEvents.length === 0}
              aria-label="Export filtered event data"
            >
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Export Data
            </Button>
            {isLive && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={togglePause}
                aria-label={isPaused ? "Resume feed" : "Pause feed"}
              >
                {isPaused ? (
                  <>
                    <PlayCircle className="mr-1 h-3.5 w-3.5 text-green-500" />
                    Resume
                  </>
                ) : (
                  <>
                    <PauseCircle className="mr-1 h-3.5 w-3.5 text-amber-500" />
                    Pause
                  </>
                )}
              </Button>
            )}
            <Button
              variant={isLive ? "destructive" : "outline"}
              size="sm"
              className={`h-7 px-3 text-xs ${
                !isLive
                  ? "border-violet-300 text-violet-700 hover:bg-violet-50 dark:border-violet-700 dark:text-violet-400 dark:hover:bg-violet-950"
                  : ""
              }`}
              onClick={toggleLive}
              aria-label={isLive ? "Stop live feed" : "Start live feed"}
            >
              <Radio className={`mr-1.5 h-3.5 w-3.5 ${isLive ? "animate-pulse" : ""}`} />
              {isLive ? "Stop Live" : "Live Feed"}
            </Button>
            <span className="text-xs text-muted-foreground">
              {filteredEvents.length} event{filteredEvents.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>

        {ready && (
          <EventFeedTable
            events={filteredEvents}
            isLoading={false}
            newEventIds={newEventIds}
            columns={prefs.columns}
            density={prefs.density}
            onToggleColumn={toggleColumn}
            onDensityChange={(d) => update({ density: d })}
          />
        )}
      </section>

      <section
        aria-label="Contribute"
        className="rounded-lg border border-violet-200 bg-violet-50 p-5 dark:border-violet-800 dark:bg-violet-950/30"
      >
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex items-start gap-3">
            <BookOpen className="mt-0.5 h-5 w-5 flex-shrink-0 text-violet-600 dark:text-violet-400" />
            <div>
              <p className="text-sm font-medium">Help translate more contracts</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Open-Audit is community-powered. Add a translation blueprint and earn
                Stellar Drips rewards.
              </p>
            </div>
          </div>
          <a
            href="https://github.com/your-org/open-audit/blob/main/CONTRIBUTING.md"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 whitespace-nowrap text-sm font-medium text-violet-700 hover:underline dark:text-violet-400"
          >
            Read the guide
            <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      </section>

      <UploadAbiDialog
        open={isUploadOpen}
        onOpenChange={setIsUploadOpen}
        onUpload={handleAbiUpload}
      />
      <ExportDataDialog
        open={isExportOpen}
        onOpenChange={setIsExportOpen}
        events={allEvents}
      />
    </div>
  );
}
