"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { AlertCircle, BookOpen, ArrowRight, Radio, PauseCircle, PlayCircle, Upload, FileJson, Trash2 } from "lucide-react";
import { SearchBar } from "@/components/dashboard/SearchBar";
import { EventFeedTable } from "@/components/dashboard/EventFeedTable";
import { StatsBar } from "@/components/dashboard/StatsBar";
import { UploadAbiDialog } from "@/components/dashboard/UploadAbiDialog";
import { Button } from "@/components/ui/button";
import { translateEvents } from "@/lib/translator/registry";
import {
  buildCustomBlueprints,
  loadCustomAbis,
  removeCustomAbi,
  saveCustomAbi,
} from "@/lib/translator/custom-abi";
import { getMockEventsForContract, MOCK_RAW_EVENTS } from "@/lib/mock-data";
import { useLiveFeed } from "@/lib/hooks/useLiveFeed";
import type { TranslatedEvent, RawEvent, CustomAbi } from "@/lib/translator/types";

/** Simulates a network delay for realistic UX. */
function simulateNetworkDelay(ms: number): Promise<void> {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

export function DashboardClient(): React.JSX.Element {
  const [rawEvents, setRawEvents] = useState<RawEvent[]>(MOCK_RAW_EVENTS);
  const [customAbis, setCustomAbis] = useState<CustomAbi[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchedContract, setSearchedContract] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isUploadOpen, setIsUploadOpen] = useState(false);

  // Load previously uploaded ABIs from localStorage after mount. Doing this in
  // an effect (rather than during render) keeps the server and client output
  // identical and avoids a hydration mismatch.
  useEffect(function () {
    setCustomAbis(loadCustomAbis());
  }, []);

  // Custom ABIs are consulted before the global registry when translating.
  const customBlueprints = useMemo(
    function () {
      return buildCustomBlueprints(customAbis);
    },
    [customAbis]
  );

  // Derive translations from the raw events + current custom blueprints so the
  // feed re-translates instantly when an ABI is uploaded or removed.
  const events = useMemo(
    function () {
      return translateEvents(rawEvents, customBlueprints);
    },
    [rawEvents, customBlueprints]
  );

  const handleNewEvent = useCallback((event: TranslatedEvent) => {
    setRawEvents((prev) => [event.raw, ...prev]);
  }, []);

  const { isLive, isPaused, newEventIds, toggleLive, togglePause } = useLiveFeed(handleNewEvent);

  const handleSearch = useCallback(async function (contractId: string): Promise<void> {
    if (!contractId) {
      setRawEvents(MOCK_RAW_EVENTS);
      setSearchedContract(null);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Simulate fetching from Stellar network
      await simulateNetworkDelay(800);

      setRawEvents(getMockEventsForContract(contractId));
      setSearchedContract(contractId);
    } catch {
      setError("Failed to fetch events. Please check the Contract ID and try again.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleAbiUpload = useCallback(function (abi: CustomAbi): void {
    setCustomAbis(saveCustomAbi(abi));
    setIsUploadOpen(false);
  }, []);

  const handleAbiRemove = useCallback(function (contractId: string): void {
    setCustomAbis(removeCustomAbi(contractId));
  }, []);

  return (
    <div className="space-y-6">
      {/* Search */}
      <section aria-label="Contract search">
        <SearchBar onSearch={handleSearch} isLoading={isLoading} />
      </section>

      {/* Error state */}
      {error && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive"
        >
          <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {/* Active filter indicator */}
      {searchedContract && !isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Showing events for:</span>
          <code className="font-mono text-xs bg-muted px-2 py-1 rounded">
            {searchedContract.slice(0, 10)}...{searchedContract.slice(-6)}
          </code>
          <button
            type="button"
            onClick={function () {
              handleSearch("");
            }}
            className="text-violet-600 dark:text-violet-400 hover:underline text-xs"
            aria-label={`Clear filter for contract ${searchedContract?.slice(0, 10)}`}
          >
            Clear filter
          </button>
        </div>
      )}

      {/* Custom ABI controls */}
      <section aria-label="Custom ABIs" className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={function () {
            setIsUploadOpen(true);
          }}
        >
          <Upload className="h-4 w-4 mr-2" />
          Upload Custom ABI
        </Button>

        {customAbis.map(function (abi) {
          return (
            <span
              key={abi.contractId}
              className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 pl-2.5 pr-1.5 py-1 text-xs"
              title={abi.contractId}
            >
              <FileJson className="h-3.5 w-3.5 text-violet-500" />
              <span className="font-medium">{abi.contractName}</span>
              <button
                type="button"
                onClick={function () {
                  handleAbiRemove(abi.contractId);
                }}
                className="text-muted-foreground hover:text-destructive transition-colors"
                aria-label={`Remove custom ABI for ${abi.contractName}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </span>
          );
        })}
      </section>

      {/* Stats */}
      {!isLoading && <StatsBar events={events} />}

      {/* Feed */}
      <section aria-label="Event feed">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            Event Feed
          </h2>
          <div className="flex items-center gap-2">
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
                    <PlayCircle className="h-3.5 w-3.5 mr-1 text-green-500" aria-hidden="true" />
                    Resume
                  </>
                ) : (
                  <>
                    <PauseCircle className="h-3.5 w-3.5 mr-1 text-amber-500" aria-hidden="true" />
                    Pause
                  </>
                )}
              </Button>
            )}
            <Button
              variant={isLive ? "destructive" : "outline"}
              size="sm"
              className={`h-7 px-3 text-xs ${!isLive ? "border-violet-300 text-violet-700 hover:bg-violet-50 dark:border-violet-700 dark:text-violet-400 dark:hover:bg-violet-950" : ""}`}
              onClick={toggleLive}
              aria-label={isLive ? "Stop live event feed" : "Start live event feed"}
            >
              <Radio className={`h-3.5 w-3.5 mr-1.5 ${isLive ? "animate-pulse" : ""}`} aria-hidden="true" />
              {isLive ? "Stop Live" : "Live Feed"}
            </Button>
            <span
              className="text-xs text-muted-foreground"
              aria-live="polite"
              aria-atomic="true"
            >
              {isLoading ? "Loading..." : `${events.length} events`}
            </span>
          </div>
        </div>
        <EventFeedTable events={events} isLoading={isLoading} newEventIds={newEventIds} />
      </section>

      {/* Contributor CTA */}
      <section
        aria-label="Contribute"
        className="rounded-lg border border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/30 p-5"
      >
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <BookOpen className="h-5 w-5 text-violet-600 dark:text-violet-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium">Help translate more contracts</p>
              <p className="text-sm text-muted-foreground mt-0.5">
                Open-Audit is community-powered. Add a translation blueprint and earn Stellar Drips
                rewards.
              </p>
            </div>
          </div>
          <a
            href="https://github.com/your-org/open-audit/blob/main/CONTRIBUTING.md"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-sm font-medium text-violet-700 dark:text-violet-400 hover:underline whitespace-nowrap"
          >
            Read the guide
            <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      </section>

      {/* Upload dialog */}
      <UploadAbiDialog
        open={isUploadOpen}
        onOpenChange={setIsUploadOpen}
        onUpload={handleAbiUpload}
      />
    </div>
  );
}
