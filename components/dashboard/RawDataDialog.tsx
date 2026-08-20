"use client";

import { Code, ExternalLink, Copy, Check, Loader2, AlertCircle, ChevronUp, ChevronDown } from "lucide-react";
import React, { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { useToast } from "@/lib/hooks/use-toast";
import type { RawEvent } from "@/lib/translator/types";
import { secureParseScVal } from "@/lib/translator/secure-xdr-parser";
import { scValToNative } from "stellar-sdk";

// ─── IPFS helpers ────────────────────────────────────────────────────────────

/** Returns true when a hex value looks like an IPFS CID pointer (starts with "ipfs:"). */
function isIpfsPointer(value: string): boolean {
  return typeof value === "string" && value.startsWith("ipfs:");
}

interface IpfsResolverState {
  content: string | null;
  loading: boolean;
  error: string | null;
}

/**
 * Minimal IPFS resolver hook.
 * Attempts to fetch the raw content behind an ipfs:// pointer.
 * Falls back gracefully if the gateway is unreachable.
 */
function useIpfsResolver(value: string): IpfsResolverState {
  const [state, setState] = useState<IpfsResolverState>({
    content: null,
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (!isIpfsPointer(value)) return;

    const cid = value.replace(/^ipfs:\/?\/?/, "");
    const url = `https://cloudflare-ipfs.com/ipfs/${cid}`;

    let cancelled = false;
    setState({ content: null, loading: true, error: null });

    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((text) => {
        if (!cancelled) setState({ content: text, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setState({
            content: null,
            loading: false,
            error: err instanceof Error ? err.message : String(err),
          });
      });

    return () => {
      cancelled = true;
    };
  }, [value]);

  return state;
}

// ─── XDR decode helper ────────────────────────────────────────────────────────

/**
 * Attempts to decode a hex-encoded ScVal using secureParseScVal.
 * Returns the decoded value as a JSON-serialisable object, or null on failure.
 */
function tryDecodeHex(hex: string): { decoded: unknown; error: null } | { decoded: null; error: string } {
  if (!hex || isIpfsPointer(hex)) {
    return { decoded: null, error: "Not a hex-encoded XDR value" };
  }

  try {
    const result = secureParseScVal(hex);
    if (!result.success) {
      return { decoded: null, error: result.error?.message ?? "Decoding failed" };
    }
    // Convert ScVal → native JS value for JSON display
    const native = scValToNative(result.value);
    return { decoded: native, error: null };
  } catch (err: unknown) {
    return {
      decoded: null,
      error: err instanceof Error ? err.message : "Unknown decoding error",
    };
  }
}

// ─── Shared sub-components ────────────────────────────────────────────────────

interface RawDataDialogProps {
  event: RawEvent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function CopyButton({ text }: { text: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function handleCopy(): Promise<void> {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    toast({ description: "Copied!" });

    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    timeoutRef.current = setTimeout(() => {
      setCopied(false);
      timeoutRef.current = null;
    }, 2000);
  }

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 relative"
            onClick={handleCopy}
            aria-label="Copy to clipboard"
          >
            <span aria-live="polite" className="sr-only">
              {copied ? "Copied" : ""}
            </span>
            {copied ? (
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>Copy to clipboard</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ─── DecodedValue: raw hex + toggle to decoded JSON ──────────────────────────

/**
 * Renders a hex value with an optional "Show decoded" toggle.
 * If XDR decoding succeeds the user can switch between the raw hex and a
 * formatted JSON tree. If decoding fails only the raw hex is shown.
 */
function DecodedValue({
  hex,
  mono = true,
  index,
}: {
  hex: string;
  mono?: boolean;
  index?: number;
}): React.JSX.Element {
  const [showDecoded, setShowDecoded] = useState(false);

  const { decoded, error: decodeError } = tryDecodeHex(hex);
  const canDecode = decoded !== null;

  const toggleLabel = showDecoded ? "Show raw hex" : "Show decoded";

  const decodedJson = canDecode
    ? JSON.stringify(decoded, bigIntReplacer, 2)
    : null;

  return (
    <div className="space-y-1">
      {/* Raw hex display */}
      <div className="relative">
        {index !== undefined && (
          <span className="absolute left-3 top-2 text-muted-foreground text-sm font-mono">
            [{index}]
          </span>
        )}
        <div
          className={`text-sm break-all rounded bg-muted px-3 py-2 ${mono ? "font-mono" : ""} ${index !== undefined ? "pl-12" : ""}`}
        >
          {showDecoded && decodedJson !== null ? (
            <SyntaxHighlighter
              language="json"
              style={oneDark}
              customStyle={{ margin: 0, fontSize: "0.8125rem", background: "transparent", padding: 0 }}
              showLineNumbers={false}
            >
              {decodedJson}
            </SyntaxHighlighter>
          ) : (
            hex
          )}
        </div>
      </div>

      {/* Toggle button — only shown when decoding is possible */}
      {canDecode && (
        <button
          type="button"
          onClick={() => setShowDecoded((v) => !v)}
          className="flex items-center gap-1 text-xs text-violet-500 hover:text-violet-400 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 rounded"
          aria-expanded={showDecoded}
          aria-label={toggleLabel}
        >
          {showDecoded ? (
            <ChevronUp className="h-3 w-3" aria-hidden="true" />
          ) : (
            <ChevronDown className="h-3 w-3" aria-hidden="true" />
          )}
          {toggleLabel}
        </button>
      )}

      {/* Decode-failure note (only when hex looks like XDR but failed) */}
      {!canDecode && decodeError && !isIpfsPointer(hex) && (
        <p className="text-xs text-muted-foreground italic">
          Could not decode as XDR
        </p>
      )}
    </div>
  );
}

/** JSON.stringify replacer that converts BigInt to string. */
function bigIntReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

// ─── ResolvableValue ──────────────────────────────────────────────────────────

function ResolvableValue({
  value,
  mono,
}: {
  value: string;
  mono?: boolean;
}): React.JSX.Element {
  const { content, loading, error } = useIpfsResolver(value);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
        <span>Resolving IPFS content…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-start gap-2">
        <div className="text-sm">
          <p className="text-amber-600 dark:text-amber-400 font-medium">
            IPFS content unavailable
          </p>
          <p className={`text-xs mt-1 break-all ${mono ? "font-mono" : ""}`}>
            {value}
          </p>
        </div>
      </div>
    );
  }

  const displayText = content ?? value;
  return (
    <div
      className={`text-sm break-all rounded bg-muted px-3 py-2 ${mono ? "font-mono" : ""}`}
    >
      {displayText}
    </div>
  );
}

// ─── RawDataField ─────────────────────────────────────────────────────────────

function RawDataField({
  label,
  value,
  mono,
  resolvable,
}: {
  label: string;
  value: string;
  mono?: boolean;
  resolvable?: boolean;
}): React.JSX.Element {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {label}
          {resolvable && isIpfsPointer(value) && (
            <span className="ml-2 text-violet-500 text-[10px] font-normal normal-case">
              (offloaded to IPFS)
            </span>
          )}
        </p>
        <CopyButton text={value} />
      </div>
      {resolvable ? (
        <ResolvableValue value={value} mono={mono} />
      ) : (
        <div
          className={`text-sm break-all rounded bg-muted px-3 py-2 ${mono ? "font-mono" : ""}`}
        >
          {value}
        </div>
      )}
    </div>
  );
}

// ─── TopicIpfsValue ───────────────────────────────────────────────────────────

function TopicIpfsValue({ value }: { value: string }): React.JSX.Element {
  const { content, loading, error } = useIpfsResolver(value);
  const displayText = content ?? value;

  if (loading) {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
        Resolving…
      </span>
    );
  }

  if (error) {
    return (
      <span className="inline-flex items-center gap-1 text-amber-500">
        ⚠ {value}
      </span>
    );
  }

  return <>{displayText}</>;
}

// ─── Main dialog ──────────────────────────────────────────────────────────────

export function RawDataDialog({
  event,
  open,
  onOpenChange,
}: RawDataDialogProps): React.JSX.Element {
  if (!event) return <></>;

  const horizonUrl = `https://horizon-testnet.stellar.org/transactions/${event.txHash}`;
  const rawEventJson = JSON.stringify(event, null, 2);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Code className="h-5 w-5 text-muted-foreground" />
            Raw Event Data
          </DialogTitle>
          <DialogDescription>
            Hex-encoded XDR data as received from the Stellar network. This is
            what Open-Audit translates into human-readable English. Where
            decoding is possible, use the toggle to switch between raw hex and
            the decoded structure. Large payloads (&gt;2 KB) are offloaded to
            IPFS for efficient storage.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* ── Metadata fields ── */}
          <RawDataField label="Event ID" value={event.id} mono />
          <RawDataField label="Contract ID" value={event.contractId} mono />
          <RawDataField label="Transaction Hash" value={event.txHash} mono />
          <RawDataField label="Ledger" value={event.ledger.toLocaleString()} />
          <RawDataField
            label="Timestamp"
            value={new Date(event.timestamp * 1000).toISOString()}
          />

          {/* ── Topics ── */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Topics ({event.topics.length})
              </p>
            </div>
            <div className="space-y-2">
              {event.topics.map(function (topic, index) {
                return (
                  <div key={index} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-muted-foreground">
                        Topic {index}
                      </p>
                      <CopyButton text={topic} />
                    </div>
                    {isIpfsPointer(topic) ? (
                      <div className="text-sm break-all rounded bg-muted px-3 py-2 font-mono">
                        <span className="text-muted-foreground mr-2">[{index}]</span>
                        <TopicIpfsValue value={topic} />
                      </div>
                    ) : (
                      <DecodedValue hex={topic} index={index} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Data ── */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Data
                {isIpfsPointer(event.data) && (
                  <span className="ml-2 text-violet-500 text-[10px] font-normal normal-case">
                    (offloaded to IPFS)
                  </span>
                )}
              </p>
              <CopyButton text={event.data} />
            </div>
            {isIpfsPointer(event.data) ? (
              <ResolvableValue value={event.data} mono />
            ) : (
              <DecodedValue hex={event.data} />
            )}
          </div>

          {/* ── Full JSON dump ── */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                JSON
              </p>
              <CopyButton text={rawEventJson} />
            </div>
            <div className="rounded bg-muted overflow-hidden">
              <SyntaxHighlighter
                language="json"
                style={oneDark}
                customStyle={{ margin: 0, fontSize: "0.875rem" }}
                showLineNumbers={false}
              >
                {rawEventJson}
              </SyntaxHighlighter>
            </div>
          </div>

          <div className="pt-2 border-t">
            <Button variant="outline" size="sm" asChild>
              <a href={horizonUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4 mr-2" />
                View on Stellar Expert
              </a>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
