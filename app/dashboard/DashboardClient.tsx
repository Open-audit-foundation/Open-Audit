
"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
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
import { MOCK_RAW_EVENTS } from "@/lib/mock-data";
import {
  buildCustomBlueprints,
  loadCustomAbis,
  removeCustomAbi,
  saveCustomAbi,
} from "@/lib/translator/custom-abi";
import type { TranslatedEvent, RawEvent, CustomAbi } from "@/lib/translator/types";
import { translateEvents } from "@/lib/translator/registry";

export function DashboardClient(): React.JSX.Element {
  const [rawEvents] = useState<RawEvent[]>(MOCK_RAW_EVENTS);
  const [liveEvents, setLiveEvents] = useState<TranslatedEvent[]>([]);
  const [customAbis, setCustomAbis] = useState<CustomAbi[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [searchedContract, setSearchedContract] = useState<string | null>(null);

  const { language } = useLanguage();
  const { network } = useNetwork();
  const { prefs, ready, update, toggleColumn, toggleFavorite } =
    useDashboardPrefs();
  const { filters, setFilters } = useEventFilters();

  useEffect(() => {
    setCustomAbis(loadCustomAbis());
  }, []);

  useEffect(() => {
    const fetchEvents = async () => {
      setIsLoading(true);
      setError(null);

      if (USE_MOCK_DATA) {
        setRawEvents(MOCK_RAW_EVENTS);
        setIsLoading(false);
        return;
      }

      try {
        const res = await fetch("/api/v1/events?limit=100");
        if (!res.ok) {
          throw new Error(`Failed to fetch events: ${res.statusText}`);
        }
        const events: RawEvent[] = await res.json();
        setRawEvents(events);
      } catch (err) {
        setError(err instanceof Error ? err.message : "An unknown error occurred");
      } finally {
        setIsLoading(false);
      }
    };

    fetchEvents();
  }, []);

  const customBlueprints = useMemo(
    () => buildCustomBlueprints(customAbis),
    [customAbis]
  );

  // Derive translations from the raw events + current custom blueprints so the
  // feed re-translates instantly when an ABI is uploaded or removed.
  const translatedRawEvents = useMemo(
    function () {
      return translateEvents(rawEvents, customBlueprints);
    },
    [rawEvents, customBlueprints]
  );

  // Merge live-streamed events (prepended) with the translated batch.
  const events = useMemo(
    function () {
      return [...liveEvents, ...translatedRawEvents];
    },
    [liveEvents, translatedRawEvents]
  );

  const translatedEvents = useMemo(
    () => translateEvents(rawEvents, customBlueprints, language),
    [rawEvents, customBlueprints, language]
  );

  const allEvents = useMemo(
    () => [...liveEvents, ...translatedEvents],
    [liveEvents, translatedEvents]
  );

  const filteredEvents = useMemo(
    () =>
      allEvents.filter((event) => {
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
      }),
    [allEvents, filters]
  );

  const handleNewEvent = useCallback(
    (event: TranslatedEvent): void => {
      if (filters.contractId && event.raw.contractId !== filters.contractId) return;
      setLiveEvents((prev) => [event, ...prev]);
    },
    [filters.contractId]
  );

  const handleSearch = useCallback(
    function (contractId: string): void {
      const normalized = contractId.trim();
      setSearchValue(normalized);
      setSearchedContract(normalized || null);
      setFilters({ contractId: normalized });
    },
    [setFilters]
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

  const LoadingSkeleton = () => (
    <div className="space-y-4 animate-pulse">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="h-16 bg-muted rounded-lg" />
      ))}
    </div>
  );

  const ErrorState = () => (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <div className="flex flex-col gap-2">
        <p>{error}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => window.location.reload()}
        >
          Try Again
        </Button>
      </div>
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

      {error && <ErrorState />}

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
              disabled={isLoading || allEvents.length === 0}
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

        {isLoading && <LoadingSkeleton />}
        {ready && !isLoading && !error && (
          <EventFeedTable
            events={filteredEvents}
            isLoading={isLoading}
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
