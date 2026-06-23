"use client";

import { X, ExternalLink, Shield, Clock, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import type { CrossChainJourney } from "@/lib/bridge/types";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatTs(unix: number | null): string {
  if (!unix) return "—";
  return new Date(unix * 1000).toLocaleString();
}

function explorerUrl(chain: string, txHash: string): string {
  const map: Record<string, string> = {
    stellar:  `https://stellar.expert/explorer/public/tx/${txHash}`,
    ethereum: `https://etherscan.io/tx/${txHash}`,
    optimism: `https://optimistic.etherscan.io/tx/${txHash}`,
    arbitrum: `https://arbiscan.io/tx/${txHash}`,
    base:     `https://basescan.org/tx/${txHash}`,
  };
  return map[chain] ?? "#";
}

// ─────────────────────────────────────────────────────────────────────────────
// Section component
// ─────────────────────────────────────────────────────────────────────────────

function InfoRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm break-all">{value}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Vertical timeline within the detail view
// ─────────────────────────────────────────────────────────────────────────────

interface TimelineEvent {
  icon: React.ReactNode;
  label: string;
  chain: string;
  txHash: string | null;
  timestamp: number | null;
  active: boolean;
}

function VerticalTimeline({
  steps,
}: {
  steps: TimelineEvent[];
}): React.JSX.Element {
  return (
    <ol className="relative border-l border-border ml-3 space-y-6 py-2" aria-label="Transfer journey">
      {steps.map((step, i) => (
        <li key={i} className="ml-6">
          <span
            className={`absolute -left-3 flex h-6 w-6 items-center justify-center rounded-full border bg-background ${
              step.active ? "text-primary border-primary" : "text-muted-foreground border-border"
            }`}
            aria-hidden="true"
          >
            {step.icon}
          </span>
          <div className={step.active ? "" : "opacity-50"}>
            <p className="text-sm font-medium">
              {step.label}
              <span className="ml-2 text-xs text-muted-foreground">{step.chain}</span>
            </p>
            {step.txHash && (
              <a
                href={explorerUrl(step.chain.toLowerCase(), step.txHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-0.5"
                aria-label={`View transaction on ${step.chain} explorer`}
              >
                {step.txHash.slice(0, 20)}…{step.txHash.slice(-6)}
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>
            )}
            <p className="text-xs text-muted-foreground mt-0.5">
              {formatTs(step.timestamp)}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main dialog
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  journey: CrossChainJourney | null;
  onClose: () => void;
}

export function BridgeJourneyDetail({
  journey,
  onClose,
}: Props): React.JSX.Element {
  if (!journey) return <></>;

  const steps: TimelineEvent[] = [
    {
      icon: <AlertTriangle className="h-3 w-3" />,
      label: "Burn initiated",
      chain: journey.burnChain,
      txHash: journey.burnTxHash,
      timestamp: journey.burnTimestamp,
      active: true,
    },
    {
      icon:
        journey.status === "matched" ? (
          <CheckCircle2 className="h-3 w-3" />
        ) : (
          <Clock className="h-3 w-3" />
        ),
      label: journey.status === "matched" ? "Mint confirmed" : "Awaiting mint",
      chain: journey.mintChain,
      txHash: journey.mintTxHash,
      timestamp: journey.mintTimestamp,
      active: journey.status === "matched",
    },
  ];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg overflow-y-auto max-h-[90vh]">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle>Cross-Chain Journey</DialogTitle>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        {/* Status + confidence */}
        <div className="flex items-center gap-3 mb-4">
          <Badge
            variant={
              journey.status === "matched"
                ? "success"
                : journey.status === "pending"
                ? "secondary"
                : "destructive"
            }
          >
            {journey.status}
          </Badge>
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Shield className="h-3 w-3" aria-hidden="true" />
            {journey.matchConfidence}% confidence
            {journey.matchMethod && ` · ${journey.matchMethod}`}
          </span>
        </div>

        {/* Visual timeline */}
        <VerticalTimeline steps={steps} />

        {/* Details grid */}
        <div className="grid grid-cols-2 gap-3 mt-4 border-t pt-4">
          <InfoRow
            label="Amount"
            value={`${journey.amount}${journey.token ? " " + journey.token : ""}`}
          />
          <InfoRow
            label="Latency"
            value={
              journey.latencySeconds !== null
                ? `${journey.latencySeconds}s`
                : "—"
            }
          />
          <InfoRow label="Sender"    value={journey.sender    ?? "—"} />
          <InfoRow label="Recipient" value={journey.recipient ?? "—"} />
          {journey.destinationProof && (
            <div className="col-span-2">
              <InfoRow
                label="Destination proof / nonce"
                value={
                  <span className="font-mono text-xs">
                    {journey.destinationProof}
                  </span>
                }
              />
            </div>
          )}
        </div>

        {/* Raw events */}
        {journey.events && journey.events.length > 0 && (
          <details className="mt-4 border-t pt-3">
            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
              Raw bridge events ({journey.events.length})
            </summary>
            <pre className="mt-2 text-xs bg-muted rounded p-3 overflow-auto max-h-48">
              {JSON.stringify(journey.events, null, 2)}
            </pre>
          </details>
        )}
      </DialogContent>
    </Dialog>
  );
}
