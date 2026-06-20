"use client";

import { useState } from "react";
import { Download, FileText, Braces, CheckCircle2, Layers } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  eventsToCSV,
  eventsToJSON,
  triggerDownload,
  buildFilename,
  buildExportUrl,
} from "@/lib/export-data";
import type { TranslatedEvent } from "@/lib/translator/types";

interface ExportDataDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  events: TranslatedEvent[];
  contractId?: string;
}

type ExportFormat = "csv" | "json" | "ndjson";

// Above this threshold we stream from the server instead of building a blob
const STREAM_THRESHOLD = 5_000;

const FORMAT_OPTIONS: Array<{
  id: ExportFormat;
  label: string;
  description: string;
  icon: React.ReactNode;
  ext: string;
}> = [
  {
    id: "csv",
    label: "CSV",
    description: "Opens in Excel, Google Sheets, Pandas. Best for spreadsheet analysis.",
    icon: <FileText className="h-5 w-5" />,
    ext: ".csv",
  },
  {
    id: "json",
    label: "JSON",
    description: "Structured JSON array. Ideal for API integrations and programmatic access.",
    icon: <Braces className="h-5 w-5" />,
    ext: ".json",
  },
  {
    id: "ndjson",
    label: "NDJSON",
    description: "Newline-delimited JSON. Efficient for Splunk, Jupyter, and SIEM pipelines.",
    icon: <Layers className="h-5 w-5" />,
    ext: ".ndjson",
  },
];

export function ExportDataDialog({
  open,
  onOpenChange,
  events,
  contractId,
}: ExportDataDialogProps): React.JSX.Element {
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>("csv");
  const [isExporting, setIsExporting] = useState(false);

  const isLargeExport = events.length >= STREAM_THRESHOLD;

  async function handleExport(): Promise<void> {
    setIsExporting(true);

    try {
      if (isLargeExport) {
        // Stream directly from the server — no memory spike in the browser
        const url = buildExportUrl(selectedFormat, { contractId });
        const a = document.createElement("a");
        a.href = url;
        a.download = buildFilename(selectedFormat);
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } else {
        // Small dataset — build blob in-browser, no round-trip needed
        if (selectedFormat === "csv") {
          triggerDownload(eventsToCSV(events), buildFilename("csv"), "text/csv;charset=utf-8;");
        } else if (selectedFormat === "json") {
          triggerDownload(eventsToJSON(events), buildFilename("json"), "application/json;charset=utf-8;");
        } else {
          const ndjson = events
            .map((e) => JSON.stringify({
              timestamp: new Date(e.raw.timestamp * 1000).toISOString(),
              ledger_id: e.raw.ledger,
              contract_id: e.raw.contractId,
              tx_hash: e.raw.txHash,
              event_name: e.eventType ?? "unknown",
              status: e.status,
              plain_english_translation: e.description ?? "No translation available",
            }))
            .join("\n");
          triggerDownload(ndjson, buildFilename("ndjson"), "application/x-ndjson;charset=utf-8;");
        }
      }
    } finally {
      setTimeout(function () {
        setIsExporting(false);
        onOpenChange(false);
      }, 400);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-4 w-4 text-violet-600 dark:text-violet-400" />
            Export Event Data
          </DialogTitle>
          <DialogDescription>
            Download{" "}
            <span className="font-medium text-foreground">{events.length.toLocaleString()}</span>{" "}
            events for audit records, SIEM ingestion, or offline analysis.
            {isLargeExport && (
              <span className="block mt-1 text-xs text-violet-600 dark:text-violet-400">
                Large dataset — will stream directly from the server.
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        {/* Exported columns */}
        <div className="rounded-md border bg-muted/40 px-4 py-3 text-xs text-muted-foreground space-y-1">
          <p className="font-medium text-foreground text-[11px] uppercase tracking-wider mb-1.5">
            Exported columns
          </p>
          {["Timestamp", "Ledger ID", "Contract ID", "Tx Hash", "Event Name", "Status", "Plain English Translation"].map((col) => (
            <div key={col} className="flex items-center gap-1.5">
              <CheckCircle2 className="h-3 w-3 text-violet-500 flex-shrink-0" />
              <span>{col}</span>
            </div>
          ))}
        </div>

        {/* Format selection */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Choose format
          </p>
          <div className="grid grid-cols-3 gap-2">
            {FORMAT_OPTIONS.map((option) => {
              const isSelected = selectedFormat === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setSelectedFormat(option.id)}
                  className={`flex flex-col items-start gap-1.5 rounded-lg border p-3 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
                    isSelected
                      ? "border-violet-500 bg-violet-50 dark:bg-violet-950/40 ring-1 ring-violet-500"
                      : "border-border hover:border-violet-300 hover:bg-muted/40 dark:hover:border-violet-700"
                  }`}
                  aria-pressed={isSelected}
                  aria-label={`Export as ${option.label}`}
                >
                  <div className={isSelected ? "text-violet-600 dark:text-violet-400" : "text-muted-foreground"}>
                    {option.icon}
                  </div>
                  <div>
                    <p className={`text-sm font-semibold ${isSelected ? "text-violet-700 dark:text-violet-300" : ""}`}>
                      {option.label}{" "}
                      <span className="font-normal text-xs text-muted-foreground">{option.ext}</span>
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                      {option.description}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleExport}
            disabled={isExporting || events.length === 0}
            className="bg-violet-600 hover:bg-violet-700 text-white dark:bg-violet-600 dark:hover:bg-violet-700 min-w-[120px]"
          >
            <Download className="h-3.5 w-3.5 mr-1.5" />
            {isExporting ? "Downloading…" : `Download ${selectedFormat.toUpperCase()}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
