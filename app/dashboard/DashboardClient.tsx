"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import {
  BookOpen,
  ArrowRight,
  Radio,
  PauseCircle,
  PlayCircle,
  Upload,
  FileJson,
  Trash2,
} from "lucide-react";
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
import { MOCK_RAW_EVENTS } from "@/lib/mock-data";
import { useLiveFeed } from "@/lib/hooks/useLiveFeed";
import type { TranslatedEvent, RawEvent, CustomAbi } from "@/lib/translator/types";

export function DashboardClient(): React.JSX.Element {
  const [rawEvents, setRawEvents] = useState<RawEvent[]>(MOCK_RAW_EVENTS);
  const [customAbis, setCustomAbis] = useState<CustomAbi[]>([]);
  const [contractFilter, setContractFilter] = useState<string | null>(null);
  const [eventTopicFilter, setEventTopicFilter] = useState("");
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

  const events = useMemo(
    function () {
      return translateEvents(rawEvents, customBlueprints);
    },
    [rawEvents, customBlueprints]
  );

  const filteredEvents = useMemo(
    function () {
      return events.filter(function (e) {
        if (contractFilter && e.raw.contractId !== contractFilter) {
          return false;
        }
        if (eventTopicFilter.trim()) {
          const filter = eventTopicFilter.trim().toLowerCase();
          if (!e.eventType?.toLowerCase().includes(filter)) {
            return false;
          }
        }
        return true;
      });
    },
    [events, contractFilter, eventTopicFilter]
  );

  const handleNewEvent = useCallback((event: TranslatedEvent) => {
    setRawEvents((prev) => [event.raw, ...prev]);
  }, []);

  const { isLive, isPaused, newEventIds, toggleLive, togglePause } = useLiveFeed(handleNewEvent);

  const handleContractFilter = useCallback(function (contractId: string): void {
    setContractFilter(contractId || null);
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
      {/* Filters */}
      <section aria-label="Event filters">
        <SearchBar
          onSearch={handleContractFilter}
          topicFilter={eventTopicFilter}
          onTopicFilterChange={setEventTopicFilter}
        />
      </section>

      {/* Active filter indicator */}
      {(contractFilter || eventTopicFilter) && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
          {contractFilter && (
            <>
              <span>Contract:</span>
              <code className="font-mono text-xs bg-muted px-2 py-1 rounded">
                {contractFilter.slice(0, 10)}...{contractFilter.slice(-6)}
              </code>
            </>
          )}
          {eventTopicFilter && (
            <>
              <span>Event:</span>
              <code className="font-mono text-xs bg-muted px-2 py-1 rounded">
                {eventTopicFilter}
              </code>
            </>
          )}
          <button
            type="button"
            onClick={function () {
              handleContractFilter("");
              setEventTopicFilter("");
            }}
            className="text-violet-600 dark:text-violet-400 hover:underline text-xs"
          >
            Clear all filters
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
      <StatsBar events={events} />

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
                    <PlayCircle className="h-3.5 w-3.5 mr-1 text-green-500" />
                    Resume
                  </>
                ) : (
                  <>
                    <PauseCircle className="h-3.5 w-3.5 mr-1 text-amber-500" />
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
            >
              <Radio className={`h-3.5 w-3.5 mr-1.5 ${isLive ? "animate-pulse" : ""}`} />
              {isLive ? "Stop Live" : "Live Feed"}
            </Button>
            <span className="text-xs text-muted-foreground">
              {`${filteredEvents.length} event${filteredEvents.length !== 1 ? "s" : ""}`}
            </span>
          </div>
        </div>
        <EventFeedTable events={filteredEvents} newEventIds={newEventIds} />
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
