"use client";

import { useState } from "react";
import { CheckCircle2, HelpCircle, Clock, Eye, GitBranch } from "lucide-react";
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
import { RawDataDialog } from "./RawDataDialog";
import { ContributeDialog } from "./ContributeDialog";
import { formatRelativeTime, truncateHex } from "@/lib/translator/decode";
import type { TranslatedEvent, RawEvent } from "@/lib/translator/types";

interface EventFeedTableProps {
  events: TranslatedEvent[];
  isLoading?: boolean;
  newEventIds?: Set<string>;
}

function StatusBadge({ status }: { status: TranslatedEvent["status"] }): React.JSX.Element {
  if (status === "translated") {
    return (
      <Badge variant="success" className="gap-1 whitespace-nowrap">
        <CheckCircle2 className="h-3 w-3" />
        Translated
      </Badge>
    );
  }

  if (status === "pending") {
    return (
      <Badge variant="secondary" className="gap-1 whitespace-nowrap">
        <Clock className="h-3 w-3" />
        Pending
      </Badge>
    );
  }

  return (
    <Badge variant="warning" className="gap-1 whitespace-nowrap">
      <HelpCircle className="h-3 w-3" />
      Cryptic
    </Badge>
  );
}

function SkeletonRow(): React.JSX.Element {
  return (
    <TableRow>
      {[1, 2, 3, 4, 5].map(function (i) {
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
}: EventFeedTableProps): React.JSX.Element {
  const [rawDialogEvent, setRawDialogEvent] = useState<RawEvent | null>(null);
  const [contributeDialogEvent, setContributeDialogEvent] = useState<RawEvent | null>(null);

  function handleViewRaw(event: RawEvent): void {
    setRawDialogEvent(event);
  }

  function handleContribute(event: RawEvent): void {
    setContributeDialogEvent(event);
  }

  return (
    <>
      <div className="rounded-lg border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30 hover:bg-muted/30">
              <TableHead className="w-[130px]">Status</TableHead>
              <TableHead className="w-[100px]">Time</TableHead>
              <TableHead>Translated Description</TableHead>
              <TableHead className="w-[160px] hidden md:table-cell">Contract</TableHead>
              <TableHead className="w-[180px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading
              ? Array.from({ length: 5 }).map(function (_, i) {
                  return <SkeletonRow key={i} />;
                })
              : events.map(function (event) {
                  const isTranslated = event.status === "translated";

                  return (
                    <TableRow
                      key={event.raw.id}
                      className={`group transition-colors ${newEventIds.has(event.raw.id) ? "animate-slide-in bg-violet-50/60 dark:bg-violet-950/30" : ""}`}
                    >
                      {/* Status */}
                      <TableCell>
                        <StatusBadge status={event.status} />
                      </TableCell>

                      {/* Time */}
                      <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                        {formatRelativeTime(event.raw.timestamp)}
                      </TableCell>

                      {/* Description */}
                      <TableCell>
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

                      {/* Contract ID */}
                      <TableCell className="hidden md:table-cell">
                        <span className="font-mono text-xs text-muted-foreground">
                          {event.raw.contractId.slice(0, 6)}...
                          {event.raw.contractId.slice(-4)}
                        </span>
                      </TableCell>

                      {/* Actions */}
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 text-xs"
                            onClick={function () {
                              handleViewRaw(event.raw);
                            }}
                          >
                            <Eye className="h-3.5 w-3.5 mr-1" />
                            View Raw
                          </Button>

                          {!isTranslated && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 px-2 text-xs border-violet-200 text-violet-700 hover:bg-violet-50 hover:text-violet-800 dark:border-violet-800 dark:text-violet-400 dark:hover:bg-violet-950"
                              onClick={function () {
                                handleContribute(event.raw);
                              }}
                            >
                              <GitBranch className="h-3.5 w-3.5 mr-1" />
                              Contribute
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}

            {!isLoading && events.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
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
        onOpenChange={function (open) {
          if (!open) setRawDialogEvent(null);
        }}
      />

      <ContributeDialog
        event={contributeDialogEvent}
        open={contributeDialogEvent !== null}
        onOpenChange={function (open) {
          if (!open) setContributeDialogEvent(null);
        }}
      />
    </>
  );
}
