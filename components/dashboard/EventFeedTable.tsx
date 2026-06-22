"use client";

import { useState } from "react";
import { CheckCircle2, HelpCircle, Clock, Eye, GitBranch, Settings2, Network } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RawDataDialog } from "./RawDataDialog";
import { ContributeDialog } from "./ContributeDialog";
import { DagPanel } from "@/components/dag/DagPanel";
import { formatRelativeTime, truncateHex } from "@/lib/translator/decode";
import type { TranslatedEvent, RawEvent } from "@/lib/translator/types";
import type { ColumnVisibility, Density } from "@/lib/hooks/useDashboardPrefs";

const COLUMN_LABELS: Record<keyof ColumnVisibility, string> = {
  status: "Status",
  time: "Time",
  description: "Description",
  contract: "Contract",
  actions: "Actions",
};

interface EventFeedTableProps {
  events: TranslatedEvent[];
  isLoading?: boolean;
  newEventIds?: Set<string>;
  columns: ColumnVisibility;
  density: Density;
  onToggleColumn: (col: keyof ColumnVisibility) => void;
  onDensityChange: (d: Density) => void;
}

function StatusBadge({ status }: { status: TranslatedEvent["status"] }): React.JSX.Element {
  if (status === "translated") {
    return (
      <Badge variant="success" className="gap-1 whitespace-nowrap">
        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
        <span className="sr-only">Status: </span>
        Translated
      </Badge>
    );
  }
  if (status === "pending") {
    return (
      <Badge variant="secondary" className="gap-1 whitespace-nowrap">
        <Clock className="h-3 w-3" aria-hidden="true" />
        <span className="sr-only">Status: </span>
        Pending
      </Badge>
    );
  }
  return (
    <Badge variant="warning" className="gap-1 whitespace-nowrap">
      <HelpCircle className="h-3 w-3" aria-hidden="true" />
      <span className="sr-only">Status: </span>
      Cryptic
    </Badge>
  );
}

function SkeletonRow({ colCount }: { colCount: number }): React.JSX.Element {
  return (
    <TableRow>
      {Array.from({ length: colCount }).map(function (_, i) {
        return (
          <TableCell key={i}>
            <div className="h-4 bg-muted animate-pulse rounded" />
          </TableCell>
        );
      })}
    </TableRow>
  );
}

export function EventFeedTable({
  events,
  isLoading = false,
  newEventIds = new Set(),
  columns,
  density,
  onToggleColumn,
  onDensityChange,
}: EventFeedTableProps): React.JSX.Element {
  const [rawDialogEvent, setRawDialogEvent] = useState<RawEvent | null>(null);
  const [contributeDialogEvent, setContributeDialogEvent] = useState<RawEvent | null>(null);
  const [showColMenu, setShowColMenu] = useState(false);
  /** txHash of the event whose execution DAG is being viewed, or null. */
  const [dagTxHash, setDagTxHash] = useState<string | null>(null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTableSectionElement>) => {
    if (e.target instanceof HTMLElement && e.target.tagName === "TR") {
      const currentRow = e.target as HTMLTableRowElement;
      
      if (e.key === "ArrowDown" || e.key === "j" || e.key === "J") {
        e.preventDefault();
        const nextRow = currentRow.nextElementSibling as HTMLTableRowElement;
        if (nextRow) nextRow.focus();
      } else if (e.key === "ArrowUp" || e.key === "k" || e.key === "K") {
        e.preventDefault();
        const prevRow = currentRow.previousElementSibling as HTMLTableRowElement;
        if (prevRow) prevRow.focus();
      }
    }
  };

  const cellPadding = density === "compact" ? "py-1.5" : "py-3";
  const visibleColCount = Object.values(columns).filter(Boolean).length;

  return (
    <>
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span>Density:</span>
          {(["comfortable", "compact"] as Density[]).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => onDensityChange(d)}
              className={`px-2 py-0.5 rounded capitalize transition-colors ${
                density === d
                  ? "bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300"
                  : "hover:text-foreground"
              }`}
            >
              {d}
            </button>
          ))}
        </div>

        <div className="relative">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs gap-1"
            onClick={() => setShowColMenu((v) => !v)}
            aria-label="Toggle column visibility"
          >
            <Settings2 className="h-3.5 w-3.5" />
            Columns
          </Button>

          {showColMenu && (
            <div className="absolute right-0 top-full mt-1 z-20 bg-popover border rounded-md shadow-md p-2 min-w-[140px]">
              {(Object.keys(columns) as (keyof ColumnVisibility)[]).map((col) => (
                <label
                  key={col}
                  className="flex items-center gap-2 px-2 py-1 text-sm rounded hover:bg-muted cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={columns[col]}
                    onChange={() => onToggleColumn(col)}
                    className="accent-violet-600"
                  />
                  {COLUMN_LABELS[col]}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      <div
        className="rounded-lg border bg-card overflow-hidden"
        onClick={() => showColMenu && setShowColMenu(false)}
      >
        <Table aria-label="Contract event feed">
          <TableHeader>
            <TableRow className="bg-muted/30 hover:bg-muted/30">
              {columns.status && <TableHead className="w-[130px]">Status</TableHead>}
              {columns.time && <TableHead className="w-[100px]">Time</TableHead>}
              {columns.description && <TableHead>Translated Description</TableHead>}
              {columns.contract && (
                <TableHead className="w-[160px] hidden md:table-cell">Contract</TableHead>
              )}
              {columns.actions && (
                <TableHead className="w-[180px] text-right">Actions</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody onKeyDown={handleKeyDown}>
            {isLoading
              ? Array.from({ length: 5 }).map(function (_, i) {
                  return <SkeletonRow key={i} colCount={visibleColCount} />;
                })
              : events.map(function (event) {
                  const isTranslated = event.status === "translated";

                  return (
                    <TableRow
                      key={event.raw.id}
                      tabIndex={0}
                      role="row"
                      className={`group transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-violet-500 ${
                        newEventIds.has(event.raw.id)
                          ? "animate-slide-in bg-violet-50/60 dark:bg-violet-950/30"
                          : ""
                      }`}
                    >
                      {columns.status && (
                        <TableCell className={cellPadding}>
                          <StatusBadge status={event.status} />
                        </TableCell>
                      )}

                      {columns.time && (
                        <TableCell className={`${cellPadding} text-muted-foreground text-xs whitespace-nowrap`}>
                          {formatRelativeTime(event.raw.timestamp)}
                        </TableCell>
                      )}

                      {columns.description && (
                        <TableCell className={cellPadding}>
                          {isTranslated ? (
                            <div className="space-y-0.5">
                              {event.eventType && (
                                <span className="text-xs font-medium text-violet-600 dark:text-violet-400 uppercase tracking-wide">
                                  {event.eventType}
                                </span>
                              )}
                              <p className="text-sm">{event.description}</p>
                            </div>
                          ) : (
                            <div className="space-y-0.5">
                              <p className="text-sm text-muted-foreground italic">
                                No translation available for this event.
                              </p>
                              <p className="font-mono text-xs text-muted-foreground/70">
                                {truncateHex(event.raw.data, 10)}
                              </p>
                            </div>
                          )}
                        </TableCell>
                      )}

                      {columns.contract && (
                        <TableCell className={`${cellPadding} hidden md:table-cell`}>
                          <span className="font-mono text-xs text-muted-foreground">
                            {event.raw.contractId.slice(0, 6)}...
                            {event.raw.contractId.slice(-4)}
                          </span>
                        </TableCell>
                      )}

                      {columns.actions && (
                        <TableCell className={`${cellPadding} text-right`}>
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 px-2 text-xs"
                              aria-label={`View raw data for event ${event.raw.id}`}
                              onClick={() => setRawDialogEvent(event.raw)}
                            >
                              <Eye className="h-3.5 w-3.5 mr-1" />
                              View Raw
                            </Button>

                            {/* Execution DAG — only available when txHash is present */}
                            {event.raw.txHash && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 px-2 text-xs text-violet-700 hover:text-violet-900 hover:bg-violet-50 dark:text-violet-400 dark:hover:bg-violet-950"
                                aria-label={`View execution call tree for tx ${event.raw.txHash}`}
                                onClick={() => setDagTxHash(event.raw.txHash)}
                              >
                                <Network className="h-3.5 w-3.5 mr-1" />
                                Call Tree
                              </Button>
                            )}

                            {!isTranslated && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-8 px-2 text-xs border-violet-200 text-violet-700 hover:bg-violet-50 hover:text-violet-800 dark:border-violet-800 dark:text-violet-400 dark:hover:bg-violet-950"
                                aria-label={`Contribute translation for event ${event.raw.id}`}
                                onClick={() => setContributeDialogEvent(event.raw)}
                              >
                                <GitBranch className="h-3.5 w-3.5 mr-1" />
                                Contribute
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}

            {!isLoading && events.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={visibleColCount}
                  className="text-center py-12 text-muted-foreground"
                >
                  No events found. Enter a Contract ID above to search.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <RawDataDialog
        event={rawDialogEvent}
        open={rawDialogEvent !== null}
        onOpenChange={(open) => { if (!open) setRawDialogEvent(null); }}
      />
      <ContributeDialog
        event={contributeDialogEvent}
        open={contributeDialogEvent !== null}
        onOpenChange={(open) => { if (!open) setContributeDialogEvent(null); }}
      />

      {/* ── Execution DAG dialog ─────────────────────────────────────────── */}
      <Dialog
        open={dagTxHash !== null}
        onOpenChange={(open) => { if (!open) setDagTxHash(null); }}
      >
        <DialogContent className="max-w-3xl w-full p-0 overflow-hidden">
          <DialogHeader className="px-4 pt-4 pb-0">
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
              <Network className="h-4 w-4 text-primary" />
              Execution Call Tree
            </DialogTitle>
          </DialogHeader>
          <div className="px-4 pb-4 pt-2">
            <DagPanel txHash={dagTxHash} maxTreeHeight={480} />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
