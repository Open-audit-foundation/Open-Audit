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
import { getMockEventsForContract, MOCK_RAW_EVENTS } from "@/lib/mock-data";
import {
  buildCustomBlueprints,
  loadCustomAbis,
  removeCustomAbi,
  saveCustomAbi,
} from "@/lib/translator/custom-abi";
import { translateEvents } from "@/lib/translator/registry";
import type { TranslatedEvent, RawEvent, CustomAbi } from "@/lib/translator/types";

function simulateNetworkDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function DashboardClient(): React.JSX.Element {
  const [rawEvents, setRawEvents] = useState<RawEvent[]>(MOCK_RAW_EVENTS);
  const [customAbis, setCustomAbis] = useState<CustomAbi[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [liveEvents, setLiveEvents] = useState<TranslatedEvent[]>([]);

  const { language } = useLanguage();
  const { network } = useNetwork();
  const { prefs, ready, update, toggleColumn, toggleFavorite } = useDashboardPrefs();
  const { filters, setFilters } = useEventFilters();

  useEffect(function () {
    setCustomAbis(loadCustomAbis());
  }, []);

  const customBlueprints = useMemo(
    () => buildCustomBlueprints(customAbis),
    [customAbis]
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
          const amount = Number(event.raw.data ? BigInt("0x" + event.raw.data.slice(2).replace(/[^0-9a-fA-F]/g, "0")) : 0n);
          if (Number(amount) < filters.minAmount) {
            return false;
          }
        }

        if (filters.startLedger !== undefined && event.raw.ledger < filters.startLedger) {
          return false;
        }

        if (filters.endLedger !== undefined && event.raw.ledger > filters.endLedger) {
          return false;
        }

        return true;
      }),
    [allEvents, filters]
  );

  const handleNewEvent = useCallback(
    function (event: TranslatedEvent): void {
      if (filters.contractId && event.raw.contractId !== filters.contractId) return;
      setLiveEvents((prev) => [event, ...prev]);
    },
    [filters.contractId]
  );

  const { isLive, isPaused, newEventIds, toggleLive, togglePause } =
    useLiveFeed(handleNewEvent);

  const handleAbiUpload = useCallback(function (abi: CustomAbi): void {
    setCustomAbis(saveCustomAbi(abi));
    setIsUploadOpen(false);
  }, []);

  const handleAbiRemove = useCallback(function (contractId: string): void {
    setCustomAbis(removeCustomAbi(contractId));
  }, []);

  const handleFavoriteSelect = useCallback(
    function (contractId: string): void {
      setFilters({ contractId });
    },
    [setFilters]
  );

  const isFavorited = filters.contractId
    ? prefs.favorites.includes(filters.contractId)
    : false;

  return (
    <div className="space-y-6">
      {/* Pinned contracts sidebar */}
      {ready && (
        <FavoritesSidebar
          favorites={prefs.favorites}
          activeContract={filters.contractId}
          onSelect={handleFavoriteSelect}
          onRemove={toggleFavorite}
        />
      )}

      {/* Search + favorite toggle */}
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
              <span className="text-sm text-muted-foreground">Filtered contract is pinned / unpinned by toggle.</span>
            </div>
          )}
        </div>
      </section>

      {/* Error state */}
      {error && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {/* Active filter indicator */}
      {searchedContract && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
          <span>Showing events for:</span>
          <code className="font-mono text-xs bg-muted px-2 py-1 rounded">
            {searchedContract.slice(0, 10)}...{searchedContract.slice(-6)}
          </code>
          <button
            type="button"
            onClick={() => {
              setSearchValue("");
              handleSearch("");
            }}
            className="text-violet-600 dark:text-violet-400 hover:underline text-xs"
            aria-label="Clear contract filter"
          >
            Clear all filters
          </button>
        </div>
      )}

      {/* Custom ABIs */}
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

      {/* Stats */}
      {!isLoading && <StatsBar events={allEvents} />}

      {/* Event feed */}
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

        {ready && (
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

      {/* Contribute banner */}
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
                Open-Audit is community-powered. Add a translation blueprint and earn Stellar Drips rewards.
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
