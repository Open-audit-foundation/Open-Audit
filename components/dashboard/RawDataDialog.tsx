"use client";

import { Code, ExternalLink, Copy, Check } from "lucide-react";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { useToast } from "@/lib/hooks/use-toast";
import type { RawEvent } from "@/lib/translator/types";

interface RawDataDialogProps {
  event: RawEvent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function CopyButton({ text }: { text: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  async function handleCopy(): Promise<void> {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    toast({ description: "Copied!" });
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleCopy}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>Copy to clipboard</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function RawDataField({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}): React.JSX.Element {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
        <CopyButton text={value} />
      </div>
      <div
        className={`text-sm break-all rounded bg-muted px-3 py-2 ${mono ? "font-mono" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}

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
            Hex-encoded XDR data as received from the Stellar network. This is what
            Open-Audit translates into human-readable English.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <RawDataField label="Event ID" value={event.id} mono />
          <RawDataField label="Contract ID" value={event.contractId} mono />
          <RawDataField label="Transaction Hash" value={event.txHash} mono />
          <RawDataField label="Ledger" value={event.ledger.toLocaleString()} />
          <RawDataField
            label="Timestamp"
            value={new Date(event.timestamp * 1000).toISOString()}
          />

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Topics ({event.topics.length})
              </p>
            </div>
            <div className="space-y-1">
              {event.topics.map(function (topic, index) {
                return (
                  <div key={index} className="relative">
                    <div className="absolute right-2 top-2">
                      <CopyButton text={topic} />
                    </div>
                    <div className="text-sm break-all rounded bg-muted px-3 py-2 font-mono pr-12">
                      <span className="text-muted-foreground mr-2">[{index}]</span>
                      {topic}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <RawDataField label="Data" value={event.data} mono />

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
