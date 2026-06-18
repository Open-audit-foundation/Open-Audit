"use client";

import { useMemo, useState } from "react";
import { Activity, AlertTriangle, TrendingUp, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { TranslatedEvent } from "@/lib/translator/types";

interface AnalyticsSummaryCardsProps {
  events: TranslatedEvent[];
}

type TimeWindowId = "1h" | "24h" | "7d" | "all";

interface TimeWindow {
  id: TimeWindowId;
  label: string;
  seconds: number | null;
}

const TIME_WINDOWS: TimeWindow[] = [
  { id: "1h", label: "1H", seconds: 60 * 60 },
  { id: "24h", label: "24H", seconds: 24 * 60 * 60 },
  { id: "7d", label: "7D", seconds: 7 * 24 * 60 * 60 },
  { id: "all", label: "All", seconds: null },
];

const SHORT_ADDRESS_REGEX = /G[A-Z0-9]{3}\.{3}[A-Z0-9]{4}/g;

interface SummaryMetrics {
  total: number;
  topEventType: string | null;
  topEventCount: number;
  uniqueAddresses: number;
  failedCount: number;
  errorRate: number;
}

function filterEventsByWindow(
  events: TranslatedEvent[],
  windowId: TimeWindowId
): TranslatedEvent[] {
  const window = TIME_WINDOWS.find(function (w) {
    return w.id === windowId;
  });
  if (!window || window.seconds === null) return events;

  const cutoff = Math.floor(Date.now() / 1000) - window.seconds;
  return events.filter(function (event) {
    return event.raw.timestamp >= cutoff;
  });
}

function computeMetrics(events: TranslatedEvent[]): SummaryMetrics {
  const total = events.length;

  const counts = new Map<string, number>();
  for (const event of events) {
    const key = event.eventType ?? "Unknown";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  let topEventType: string | null = null;
  let topEventCount = 0;
  counts.forEach(function (count, key) {
    if (count > topEventCount) {
      topEventCount = count;
      topEventType = key;
    }
  });

  const addresses = new Set<string>();
  for (const event of events) {
    if (!event.description) continue;
    const matches = event.description.match(SHORT_ADDRESS_REGEX);
    if (!matches) continue;
    for (const match of matches) {
      addresses.add(match);
    }
  }

  const failedCount = events.filter(function (event) {
    return event.status === "cryptic";
  }).length;
  const errorRate = total > 0 ? (failedCount / total) * 100 : 0;

  return {
    total,
    topEventType,
    topEventCount,
    uniqueAddresses: addresses.size,
    failedCount,
    errorRate,
  };
}

type MetricTone = "default" | "success" | "warning" | "danger";

interface MetricCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  sublabel?: string;
  tone?: MetricTone;
  isActive: boolean;
  onSelect: () => void;
}

const TONE_CLASSES: Record<MetricTone, string> = {
  default: "text-violet-500",
  success: "text-emerald-500",
  warning: "text-amber-500",
  danger: "text-rose-500",
};

function MetricCard({
  icon,
  label,
  value,
  sublabel,
  tone = "default",
  isActive,
  onSelect,
}: MetricCardProps): React.JSX.Element {
  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect();
    }
  }

  return (
    <Card
      role="button"
      tabIndex={0}
      aria-pressed={isActive}
      onClick={onSelect}
      onKeyDown={handleKeyDown}
      className={cn(
        "cursor-pointer transition-all outline-none",
        "hover:shadow-md hover:border-violet-300 dark:hover:border-violet-700",
        "focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2",
        isActive && "border-violet-500 ring-2 ring-violet-500/30 shadow-md"
      )}
    >
      <CardContent className="p-4 flex items-center gap-3">
        <div className={cn("flex-shrink-0", TONE_CLASSES[tone])}>{icon}</div>
        <div className="min-w-0">
          <p className="text-2xl font-semibold leading-none truncate" title={value}>
            {value}
          </p>
          <p className="text-xs text-muted-foreground mt-1">{label}</p>
          {sublabel && (
            <p className="text-xs text-muted-foreground/60 truncate" title={sublabel}>
              {sublabel}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function getErrorTone(errorRate: number): MetricTone {
  if (errorRate >= 25) return "danger";
  if (errorRate >= 10) return "warning";
  return "success";
}

function formatWindowSublabel(windowId: TimeWindowId): string {
  if (windowId === "all") return "across all time";
  const labelMap: Record<Exclude<TimeWindowId, "all">, string> = {
    "1h": "in the last hour",
    "24h": "in the last 24 hours",
    "7d": "in the last 7 days",
  };
  return labelMap[windowId];
}

export function AnalyticsSummaryCards({ events }: AnalyticsSummaryCardsProps): React.JSX.Element {
  const [windowId, setWindowId] = useState<TimeWindowId>("24h");
  const [activeCard, setActiveCard] = useState<string | null>(null);

  const filteredEvents = useMemo(
    function () {
      return filterEventsByWindow(events, windowId);
    },
    [events, windowId]
  );

  const metrics = useMemo(
    function () {
      return computeMetrics(filteredEvents);
    },
    [filteredEvents]
  );

  function toggleCard(key: string): void {
    setActiveCard(function (current) {
      return current === key ? null : key;
    });
  }

  const windowSublabel = formatWindowSublabel(windowId);

  return (
    <section aria-label="Event analytics summary" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          Analytics
        </h2>
        <div
          role="tablist"
          aria-label="Time window"
          className="inline-flex rounded-md border bg-muted/40 p-0.5 text-xs"
        >
          {TIME_WINDOWS.map(function (window) {
            const isSelected = window.id === windowId;
            return (
              <button
                key={window.id}
                role="tab"
                type="button"
                aria-selected={isSelected}
                onClick={function () {
                  setWindowId(window.id);
                }}
                className={cn(
                  "px-2.5 py-1 rounded-sm font-medium transition-colors",
                  isSelected
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {window.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard
          icon={<Activity className="h-5 w-5" />}
          label="Total Events Emitted"
          value={metrics.total.toLocaleString()}
          sublabel={windowSublabel}
          isActive={activeCard === "total"}
          onSelect={function () {
            toggleCard("total");
          }}
        />
        <MetricCard
          icon={<TrendingUp className="h-5 w-5" />}
          label="Top Active Event Type"
          value={metrics.topEventType ?? "—"}
          sublabel={
            metrics.topEventType
              ? `${metrics.topEventCount.toLocaleString()} occurrences`
              : "no events in window"
          }
          tone="success"
          isActive={activeCard === "topType"}
          onSelect={function () {
            toggleCard("topType");
          }}
        />
        <MetricCard
          icon={<Users className="h-5 w-5" />}
          label="Unique Interacting Addresses"
          value={metrics.uniqueAddresses.toLocaleString()}
          sublabel="participating accounts"
          isActive={activeCard === "addresses"}
          onSelect={function () {
            toggleCard("addresses");
          }}
        />
        <MetricCard
          icon={<AlertTriangle className="h-5 w-5" />}
          label="Error / Failure Rate"
          value={`${metrics.errorRate.toFixed(1)}%`}
          sublabel={`${metrics.failedCount.toLocaleString()} untranslated`}
          tone={getErrorTone(metrics.errorRate)}
          isActive={activeCard === "errors"}
          onSelect={function () {
            toggleCard("errors");
          }}
        />
      </div>
    </section>
  );
}
