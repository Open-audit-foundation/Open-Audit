"use client";

import { CheckCircle2, Clock, XCircle, Zap } from "lucide-react";
import type { CrossChainJourney } from "@/lib/bridge/types";

interface Props {
  matches: CrossChainJourney[];
}

export function BridgeStatsBar({ matches }: Props): React.JSX.Element {
  const matched   = matches.filter((m) => m.status === "matched").length;
  const pending   = matches.filter((m) => m.status === "pending").length;
  const unmatched = matches.filter((m) => m.status === "unmatched" || m.status === "disputed").length;

  const avgLatency = (() => {
    const latencies = matches
      .filter((m) => m.latencySeconds !== null)
      .map((m) => m.latencySeconds as number);
    if (latencies.length === 0) return null;
    return Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
  })();

  const stats = [
    {
      label: "Matched",
      value: matched,
      icon: <CheckCircle2 className="h-4 w-4 text-green-500" aria-hidden="true" />,
    },
    {
      label: "Pending",
      value: pending,
      icon: <Clock className="h-4 w-4 text-yellow-500" aria-hidden="true" />,
    },
    {
      label: "Unmatched",
      value: unmatched,
      icon: <XCircle className="h-4 w-4 text-red-500" aria-hidden="true" />,
    },
    {
      label: "Avg Latency",
      value: avgLatency !== null ? `${avgLatency}s` : "—",
      icon: <Zap className="h-4 w-4 text-blue-500" aria-hidden="true" />,
    },
  ];

  return (
    <div
      className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6"
      role="region"
      aria-label="Bridge transfer statistics"
    >
      {stats.map((s) => (
        <div
          key={s.label}
          className="rounded-lg border bg-card px-4 py-3 flex items-center gap-3"
        >
          {s.icon}
          <div>
            <p className="text-lg font-semibold leading-none">{s.value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
