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
  ChevronLeft,
  ChevronRight,
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
import { MOCK_RAW_EVENTS } from "@/lib/mock-data";
import {
  buildCustomBlueprints,
  loadCustomAbis,
  removeCustomAbi,
  saveCustomAbi,
} from "@/lib/translator/custom-abi";
import { translateEvents } from "@/lib/translator/registry";
import type { TranslatedEvent, RawEvent, CustomAbi } from "@/lib/translator/types";

// ---------------------------------------------------------------------------
// Types for the server response
// ---------------------------------------------------------------------------
interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

interface EventsApiResponse {
  events: RawEvent[];
  pagination: PaginationMeta;
  meta: { network: string; fallback?: boolean };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function DashboardClient(): React.JSX.Element {
  const [serverEvents, setServerEvents] = useState<RawEvent[]>([]);
  const [liveEvents, setLiveEvents] = useState<TranslatedEvent[]>([]);
  const [customAbis, setCustomAbis] = useState<CustomAbi[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [pagination, setPagination] = useState<PaginationMeta>({
    total: 0,
    page: 1,
    limit: 20,
    totalPages: 1,
    hasNext: false,
    hasPrev: false,
  });

  const { language } = useLanguage();
  const { network } = useNetwork();
  const { prefs, ready, update, toggleColumn, toggleFavorite } = useDashboardPrefs();
  const { filters, setFilters, setPage, clearAll } = useEventFilters();

  // Load custom ABIs from localStorage on mount
  useEffect(function () {
    setCustomAbis(loadCustomAbis());
  }, []);

  const customBlueprints = useMemo(
    () => buildCustomBlueprints(customAbis),
    [customAbis]
  );

  // ─── Server-side fetch: triggered on filter / page / network changes ──────
  useEffect(
    function () {
      const controller = new AbortController();

      async function fetchEvents(): Promise<void> {
        setIsLoading(true);
        setError(null);

        const params = new URLSearchParams();
        if (filters.contractId) params.set("contractId", filters.contractId);
        if (filters.eventType) params.set("eventType", filters.eventType);
        if (filters.network) {
          params.set("network", filters.network);
        } else if (network) {
          params.set("network", network);
        }
        params.set("page", String(filters.page));
        params.set("limit", "20");

        try {
          const res = await fetch(`/api/v1/events?${params.toString()}`, {
            signal: controller.signal,
          });

          if (!res.ok) {
            throw new Error(`Server responded with ${res.status}`);
          }

          const data: EventsApiResponse = await res.json();
          setServerEvents(data.events);
          setPagination(data.pagination);
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") return;

          console.error("Failed to fetch events from server, using mock data:", err);

          // Fallback to client-side mock data
          const fallback = filters.contractId
            ? MOCK_RAW_EVENTS.filter((e) => e.contractId === filters.contractId)
            : MOCK_RAW_EVENTS;

          setServerEvents(fallback);
          setPagination({
            total: fallback.length,
            page: 1,
            limit: 20,
            totalPages: Math.max(1, Math.ceil(fallback.length / 20)),
            hasNext: false,
            hasPrev: false,
          });
        } finally {
          setIsLoading(false);
        }
      }

      fetchEvents();
      return () => controller.abort();
    },
    [filters.contractId, filters.eventType, filters.network, filters.page, network]
  );

  // Translate server events with custom blueprints
  const translatedEvents = useMemo(
    () => translateEvents(serverEvents, customBlueprints, language),
    [serverEvents, customBlueprints, language]
  );

  // Merge live-streamed events (prepended) with the server-fetched batch
  const allEvents = useMemo(
    () => [...liveEvents, ...translatedEvents],
    [liveEvents, translatedEvents]
  );

  // Client-side secondary filtering for ledger range and amount
  const filteredEvents = useMemo(
    () =>
      allEvents.filter((event) => {
        if (filters.minAmount !== undefined) {
          const amount = Number(
            event.raw.data
              ? BigInt("0x" + event.raw.data.slice(2).replace(/[^0-9a-fA-F]/g, "0"))
              : 0n
          );
          if (amount < filters.minAmount) return false;
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

  // ─── Live feed handler ────────────────────────────────────────────────────
  const handleNewEvent = useCallback(
    function (event: TranslatedEvent): void {
      if (filters.contractId && event.raw.contractId !== filters.contractId) return;
      setLiveEvents((prev) => [event, ...prev]);
    },
    [filters.contractId]
  );

  const { isLive, isPaused, newEventIds, toggleLive, togglePause } =
    useLiveFeed(handleNewEvent);

  // ─── ABI handlers ─────────────────────────────────────────────────────────
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

  // ─── Pagination handlers ──────────────────────────────────────────────────
  function goToPage(page: number): void {
    setPage(Math.max(1, Math.min(page, pagination.totalPages)));
  }

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
              {pagination.total > 0 && ` of ${pagination.total}`}
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

      {/* ── Pagination controls ─────────────────────────────────────────────── */}
      {pagination.totalPages > 1 && (
        <nav
          aria-label="Pagination"
          className="flex items-center justify-center gap-2 pt-2"
        >
          <Button
            variant="outline"
            size="sm"
            className="h-9 px-3 text-xs"
            disabled={!pagination.hasPrev}
            onClick={() => goToPage(pagination.page - 1)}
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Previous
          </Button>

          {/* Page number buttons */}
          <div className="flex items-center gap-1">
            {Array.from({ length: Math.min(pagination.totalPages, 7) }, (_, i) => {
              // Show pages around the current page
              let pageNum: number;
              const total = pagination.totalPages;
              const current = pagination.page;

              if (total <= 7) {
                pageNum = i + 1;
              } else if (current <= 4) {
                pageNum = i + 1;
              } else if (current >= total - 3) {
                pageNum = total - 6 + i;
              } else {
                pageNum = current - 3 + i;
              }

              return (
                <Button
                  key={pageNum}
                  variant={pageNum === current ? "default" : "outline"}
                  size="sm"
                  className={`h-9 w-9 p-0 text-xs ${
                    pageNum === current
                      ? "bg-violet-600 text-white hover:bg-violet-700"
                      : ""
                  }`}
                  onClick={() => goToPage(pageNum)}
                  aria-label={`Go to page ${pageNum}`}
                  aria-current={pageNum === current ? "page" : undefined}
                >
                  {pageNum}
                </Button>
              );
            })}
          </div>

          <Button
            variant="outline"
            size="sm"
            className="h-9 px-3 text-xs"
            disabled={!pagination.hasNext}
            onClick={() => goToPage(pagination.page + 1)}
            aria-label="Next page"
          >
            Next
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </nav>
      )}

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
