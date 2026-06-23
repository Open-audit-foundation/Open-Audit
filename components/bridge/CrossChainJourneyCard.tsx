"use client";

import {
  ArrowRight,
  CheckCircle2,
  Clock,
  AlertTriangle,
  XCircle,
  Shield,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { CrossChainJourney, MatchStatus } from "@/lib/bridge/types";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function shortHash(hash: string | null, len = 8): string {
  if (!hash) return "—";
  return `${hash.slice(0, len + 2)}…${hash.slice(-4)}`;
}

function formatTimestamp(unix: number | null): string {
  if (!unix) return "—";
  return new Date(unix * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatLatency(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

function chainLabel(chain: string): string {
  const map: Record<string, string> = {
    stellar:  "Stellar",
    ethereum: "Ethereum",
    optimism: "Optimism",
    arbitrum: "Arbitrum",
    base:     "Base",
  };
  return map[chain] ?? chain;
}

// ─────────────────────────────────────────────────────────────────────────────
// Status badge
// ─────────────────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: MatchStatus }): React.JSX.Element {
  if (status === "matched") {
    return (
      <Badge variant="success" className="gap-1">
        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
        Matched
      </Badge>
    );
  }
  if (status === "pending") {
    return (
      <Badge variant="secondary" className="gap-1">
        <Clock className="h-3 w-3" aria-hidden="true" />
        Pending
      </Badge>
    );
  }
  if (status === "disputed") {
    return (
      <Badge variant="warning" className="gap-1">
        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
        Disputed
      </Badge>
    );
  }
  return (
    <Badge variant="destructive" className="gap-1">
      <XCircle className="h-3 w-3" aria-hidden="true" />
      Unmatched
    </Badge>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Confidence indicator
// ─────────────────────────────────────────────────────────────────────────────

function ConfidencePill({
  confidence,
  method,
}: {
  confidence: number;
  method: string | null;
}): React.JSX.Element {
  const color =
    confidence >= 90
      ? "text-green-600"
      : confidence >= 70
      ? "text-yellow-600"
      : "text-red-600";

  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${color}`}>
      <Shield className="h-3 w-3" aria-hidden="true" />
      {confidence}% confidence
      {method && <span className="text-muted-foreground">({method})</span>}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Timeline step
// ─────────────────────────────────────────────────────────────────────────────

interface StepProps {
  label: string;
  chain: string;
  txHash: string | null;
  timestamp: number | null;
  active: boolean;
}

function TimelineStep({
  label,
  chain,
  txHash,
  timestamp,
  active,
}: StepProps): React.JSX.Element {
  return (
    <div
      className={`flex flex-col gap-0.5 min-w-0 ${active ? "" : "opacity-40"}`}
      aria-label={`${label} on ${chainLabel(chain)}`}
    >
      <span className="text-xs text-muted-foreground uppercase tracking-wider">
        {label}
      </span>
      <span className="text-sm font-semibold">{chainLabel(chain)}</span>
      <span
        className="text-xs font-mono text-muted-foreground truncate"
        title={txHash ?? undefined}
      >
        {shortHash(txHash)}
      </span>
      <span className="text-xs text-muted-foreground">
        {formatTimestamp(timestamp)}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main card
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  journey: CrossChainJourney;
  onClick?: (journey: CrossChainJourney) => void;
}

export function CrossChainJourneyCard({
  journey,
  onClick,
}: Props): React.JSX.Element {
  return (
    <article
      className="rounded-lg border bg-card p-4 hover:bg-accent/30 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      role="button"
      tabIndex={0}
      onClick={() => onClick?.(journey)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onClick?.(journey);
      }}
      aria-label={`Cross-chain transfer ${shortHash(journey.burnTxHash)} — ${journey.status}`}
    >
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <StatusBadge status={journey.status} />
        <ConfidencePill
          confidence={journey.matchConfidence}
          method={journey.matchMethod}
        />
      </div>

      {/* Amount + token */}
      <div className="flex items-center gap-2 mb-3">
        <Zap className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
        <span className="text-sm font-medium truncate">
          {journey.amount}
          {journey.token ? ` ${journey.token}` : ""}
        </span>
        {journey.latencySeconds !== null && (
          <span className="ml-auto text-xs text-muted-foreground whitespace-nowrap">
            {formatLatency(journey.latencySeconds)} latency
          </span>
        )}
      </div>

      {/* Journey timeline */}
      <div className="flex items-center gap-3">
        <TimelineStep
          label="Burn"
          chain={journey.burnChain}
          txHash={journey.burnTxHash}
          timestamp={journey.burnTimestamp}
          active
        />

        <ArrowRight
          className="h-5 w-5 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />

        <TimelineStep
          label="Mint"
          chain={journey.mintChain}
          txHash={journey.mintTxHash}
          timestamp={journey.mintTimestamp}
          active={journey.status === "matched"}
        />
      </div>

      {/* Proof */}
      {journey.destinationProof && (
        <p className="mt-3 text-xs text-muted-foreground font-mono truncate">
          <span className="text-foreground/60">Proof:</span>{" "}
          {journey.destinationProof}
        </p>
      )}
    </article>
  );
}
