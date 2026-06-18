"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import {
  CheckCircle2,
  HelpCircle,
  Clock,
  Eye,
  GitBranch,
  Search,
  Filter,
  Calendar,
  X,
  SlidersHorizontal,
} from "lucide-react";
import {
  useReactTable,
  getCoreRowModel,
  getPaginationRowModel,
  getFilteredRowModel,
  flexRender,
  ColumnDef,
  FilterFn,
} from "@tanstack/react-table";
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
import { Input } from "@/components/ui/input";
import { RawDataDialog } from "./RawDataDialog";
import { ContributeDialog } from "./ContributeDialog";
import { formatRelativeTime, truncateHex } from "@/lib/translator/decode";
import type { TranslatedEvent, RawEvent } from "@/lib/translator/types";

const STORAGE_KEY = "open-audit:filter-state";
const PAGE_SIZE = 50;

interface FilterState {
  contractFilter: string;
  dateFrom: string;
  dateTo: string;
  eventTypeFilter: string;
}

const DEFAULT_FILTER_STATE: FilterState = {
  contractFilter: "",
  dateFrom: "",
  dateTo: "",
  eventTypeFilter: "",
};

function loadFilterState(): FilterState {
  if (typeof window === "undefined") return DEFAULT_FILTER_STATE;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_FILTER_STATE;
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      "contractFilter" in parsed &&
      "dateFrom" in parsed &&
      "dateTo" in parsed &&
      "eventTypeFilter" in parsed
    ) {
      return parsed as FilterState;
    }
    return DEFAULT_FILTER_STATE;
  } catch {
    return DEFAULT_FILTER_STATE;
  }
}

function saveFilterState(state: FilterState): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore storage errors
  }
}

function clearFilterState(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

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
    <TableRow className="hover:bg-transparent">
      <TableCell>
        <div className="h-5 w-20 bg-muted animate-pulse rounded-full" />
      </TableCell>
      <TableCell>
        <div className="h-3.5 w-14 bg-muted animate-pulse rounded" />
      </TableCell>
      <TableCell>
        <div className="space-y-1.5">
          <div className="h-3 w-16 bg-muted animate-pulse rounded" />
          <div className="h-4 w-64 bg-muted animate-pulse rounded" />
        </div>
      </TableCell>
      <TableCell className="hidden md:table-cell">
        <div className="h-3.5 w-24 bg-muted animate-pulse rounded" />
      </TableCell>
      <TableCell>
        <div className="flex justify-end">
          <div className="h-7 w-20 bg-muted animate-pulse rounded-md" />
        </div>
      </TableCell>
    </TableRow>
  );
}

// eslint-disable-next-line func-style
const dateRangeFilter: FilterFn<TranslatedEvent> = (row, _columnId, value) => {
  const { dateFrom, dateTo } = value as { dateFrom: string; dateTo: string };
  if (!dateFrom && !dateTo) return true;
  const rowDate = new Date(row.original.raw.timestamp * 1000);
  if (dateFrom) {
    const from = new Date(dateFrom);
    from.setUTCHours(0, 0, 0, 0);
    if (rowDate < from) return false;
  }
  if (dateTo) {
    const to = new Date(dateTo);
    to.setUTCHours(23, 59, 59, 999);
    if (rowDate > to) return false;
  }
  return true;
};

export function EventFeedTable({
  events,
  isLoading = false,
  newEventIds = new Set(),
}: EventFeedTableProps): React.JSX.Element {
  const tableTopRef = useRef<HTMLDivElement>(null);
  const [rawDialogEvent, setRawDialogEvent] = useState<RawEvent | null>(null);
  const [contributeDialogEvent, setContributeDialogEvent] = useState<RawEvent | null>(null);

  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTER_STATE);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from localStorage after mount to avoid SSR mismatch
  useEffect(function () {
    setFilters(loadFilterState());
    setHydrated(true);
  }, []);

  // Persist filter state on change (skip initial hydration pass)
  useEffect(
    function () {
      if (!hydrated) return;
      const isEmpty =
        !filters.contractFilter &&
        !filters.dateFrom &&
        !filters.dateTo &&
        !filters.eventTypeFilter;
      if (isEmpty) {
        clearFilterState();
      } else {
        saveFilterState(filters);
      }
    },
    [filters, hydrated]
  );

  const dateRangeError =
    filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo
      ? "Start date must be before end date"
      : null;

  const updateFilter = useCallback(function <K extends keyof FilterState>(
    key: K,
    value: FilterState[K]
  ): void {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  const clearAllFilters = useCallback(function (): void {
    setFilters(DEFAULT_FILTER_STATE);
    clearFilterState();
  }, []);

  const activeFilterCount = [
    filters.contractFilter,
    filters.dateFrom,
    filters.dateTo,
    filters.eventTypeFilter,
  ].filter(Boolean).length;

  // Derive unique event types from the full dataset
  const eventTypeOptions = useMemo(function () {
    const seen = new Set<string>();
    for (const e of events) {
      if (e.eventType) seen.add(e.eventType.toLowerCase());
    }
    return Array.from(seen).sort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events]);

  const columns = useMemo<ColumnDef<TranslatedEvent>[]>(
    () => [
      {
        id: "status",
        accessorFn: (row) => row.status,
        header: "Status",
        cell: (info) => <StatusBadge status={info.getValue() as TranslatedEvent["status"]} />,
      },
      {
        id: "timestamp",
        accessorFn: (row) => row.raw.timestamp,
        header: "Time",
        filterFn: dateRangeFilter,
        cell: (info) => (
          <span className="text-muted-foreground text-xs whitespace-nowrap">
            {formatRelativeTime(info.getValue() as number)}
          </span>
        ),
      },
      {
        id: "description",
        accessorFn: (row) => row.eventType || "",
        header: "Translated Description",
        filterFn: "includesString",
        cell: (info) => {
          const event = info.row.original;
          const isTranslated = event.status === "translated";
          if (isTranslated) {
            return (
              <div className="space-y-0.5">
                {event.eventType && (
                  <span className="text-xs font-medium text-violet-600 dark:text-violet-400 uppercase tracking-wide">
                    {event.eventType}
                  </span>
                )}
                <p className="text-sm">{event.description}</p>
              </div>
            );
          }
          return (
            <div className="space-y-0.5">
              <p className="text-sm text-muted-foreground italic">
                No translation available for this event.
              </p>
              <p className="font-mono text-xs text-muted-foreground/70">
                {truncateHex(event.raw.data, 10)}
              </p>
            </div>
          );
        },
      },
      {
        id: "contractId",
        accessorFn: (row) => row.raw.contractId,
        header: () => <div className="hidden md:block">Contract</div>,
        filterFn: "includesString",
        cell: (info) => {
          const contractId = info.getValue() as string;
          return (
            <span className="font-mono text-xs text-muted-foreground hidden md:inline-block">
              {contractId.slice(0, 6)}...{contractId.slice(-4)}
            </span>
          );
        },
      },
      {
        id: "actions",
        header: () => <div className="text-right">Actions</div>,
        cell: (info) => {
          const event = info.row.original;
          const isTranslated = event.status === "translated";
          return (
            <div className="flex items-center justify-end gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs"
                onClick={() => setRawDialogEvent(event.raw)}
              >
                <Eye className="h-3.5 w-3.5 mr-1" />
                View Raw
              </Button>
              {!isTranslated && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 px-2 text-xs border-violet-200 text-violet-700 hover:bg-violet-50 hover:text-violet-800 dark:border-violet-800 dark:text-violet-400 dark:hover:bg-violet-950"
                  onClick={() => setContributeDialogEvent(event.raw)}
                >
                  <GitBranch className="h-3.5 w-3.5 mr-1" />
                  Contribute
                </Button>
              )}
            </div>
          );
        },
      },
    ],
    []
  );

  const columnFilters = useMemo(() => {
    const f = [];
    if (filters.contractFilter) f.push({ id: "contractId", value: filters.contractFilter });
    if (!dateRangeError && (filters.dateFrom || filters.dateTo)) {
      f.push({ id: "timestamp", value: { dateFrom: filters.dateFrom, dateTo: filters.dateTo } });
    }
    if (filters.eventTypeFilter) f.push({ id: "description", value: filters.eventTypeFilter });
    return f;
  }, [filters, dateRangeError]);

  const table = useReactTable({
    data: dateRangeError ? [] : events,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    state: { columnFilters },
    initialState: {
      pagination: { pageSize: PAGE_SIZE },
    },
  });

  // Reset to page 1 when filters change
  useEffect(
    function () {
      table.setPageIndex(0);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filters]
  );

  function handlePageChange(action: "prev" | "next"): void {
    if (action === "prev") table.previousPage();
    else table.nextPage();
    tableTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const filteredCount = table.getFilteredRowModel().rows.length;
  const visibleCount = table.getRowModel().rows.length;

  return (
    <>
      <div className="space-y-4">
        {/* Filter Toolbar */}
        <div
          className="flex flex-col gap-3 bg-card p-3 rounded-lg border"
          role="search"
          aria-label="Event filters"
        >
          <div className="flex flex-col sm:flex-row gap-3">
            {/* Contract ID filter */}
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Filter by Contract ID..."
                value={filters.contractFilter}
                onChange={(e) => updateFilter("contractFilter", e.target.value)}
                className="pl-9 h-9 text-sm"
                aria-label="Filter by Contract ID"
              />
            </div>

            {/* Date range */}
            <div className="flex gap-2 flex-wrap">
              <div className="relative">
                <Calendar className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  type="date"
                  value={filters.dateFrom}
                  onChange={(e) => updateFilter("dateFrom", e.target.value)}
                  className="pl-9 h-9 text-sm w-[150px]"
                  aria-label="Filter from date"
                />
              </div>
              <div className="relative">
                <Calendar className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  type="date"
                  value={filters.dateTo}
                  onChange={(e) => updateFilter("dateTo", e.target.value)}
                  className="pl-9 h-9 text-sm w-[150px]"
                  aria-label="Filter to date"
                />
              </div>
            </div>

            {/* Event type dropdown */}
            <div className="relative">
              <Filter className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
              <select
                value={filters.eventTypeFilter}
                onChange={(e) => updateFilter("eventTypeFilter", e.target.value)}
                className="h-9 w-[160px] pl-9 pr-3 rounded-md border border-input bg-transparent text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 appearance-none"
                aria-label="Filter by event type"
              >
                <option value="">All Event Types</option>
                {eventTypeOptions.map((type) => (
                  <option key={type} value={type}>
                    {type.charAt(0).toUpperCase() + type.slice(1)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Active filters row */}
          {(activeFilterCount > 0 || dateRangeError) && (
            <div className="flex items-center justify-between gap-2 pt-1 border-t">
              <div className="flex items-center gap-2 flex-wrap">
                {activeFilterCount > 0 && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                    <span>
                      {activeFilterCount} active filter{activeFilterCount !== 1 ? "s" : ""}
                    </span>
                  </span>
                )}
                {dateRangeError && (
                  <span className="text-xs text-destructive" role="alert">
                    {dateRangeError}
                  </span>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={clearAllFilters}
                aria-label="Clear all filters"
              >
                <X className="h-3.5 w-3.5 mr-1" />
                Clear all filters
              </Button>
            </div>
          )}
        </div>

        {/* Table */}
        <div ref={tableTopRef} className="rounded-lg border bg-card overflow-hidden">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id} className="bg-muted/30 hover:bg-muted/30">
                  {headerGroup.headers.map((header) => {
                    let widthClass = "";
                    if (header.id === "status") widthClass = "w-[130px]";
                    if (header.id === "timestamp") widthClass = "w-[100px]";
                    if (header.id === "contractId") widthClass = "w-[160px] hidden md:table-cell";
                    if (header.id === "actions") widthClass = "w-[180px]";

                    return (
                      <TableHead key={header.id} className={widthClass}>
                        {header.isPlaceholder
                          ? null
                          : flexRender(header.column.columnDef.header, header.getContext())}
                      </TableHead>
                    );
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
              ) : table.getRowModel().rows?.length ? (
                table.getRowModel().rows.map((row) => {
                  const event = row.original;
                  return (
                    <TableRow
                      key={row.id}
                      className={`group transition-colors ${
                        newEventIds.has(event.raw.id)
                          ? "animate-slide-in bg-violet-50/60 dark:bg-violet-950/30"
                          : ""
                      }`}
                    >
                      {row.getVisibleCells().map((cell) => {
                        let hiddenClass = "";
                        if (cell.column.id === "contractId") hiddenClass = "hidden md:table-cell";

                        return (
                          <TableCell key={cell.id} className={hiddenClass}>
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={columns.length}
                    className="text-center py-12 text-muted-foreground"
                  >
                    No events found. Adjust your filters or search.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination Controls */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-2">
          {/* Row count — aria-live so screen readers announce changes */}
          <div aria-live="polite" aria-atomic="true" className="text-sm text-muted-foreground">
            Showing {visibleCount} of {filteredCount} events
          </div>
          <div className="flex items-center space-x-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePageChange("prev")}
              disabled={!table.getCanPreviousPage()}
              aria-disabled={!table.getCanPreviousPage()}
              aria-label="Previous page"
            >
              Previous
            </Button>
            <div className="text-sm font-medium" aria-live="polite" aria-atomic="true">
              Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount() || 1}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePageChange("next")}
              disabled={!table.getCanNextPage()}
              aria-disabled={!table.getCanNextPage()}
              aria-label="Next page"
            >
              Next
            </Button>
          </div>
        </div>
      </div>

      <RawDataDialog
        event={rawDialogEvent}
        open={rawDialogEvent !== null}
        onOpenChange={(open) => {
          if (!open) setRawDialogEvent(null);
        }}
      />

      <ContributeDialog
        event={contributeDialogEvent}
        open={contributeDialogEvent !== null}
        onOpenChange={(open) => {
          if (!open) setContributeDialogEvent(null);
        }}
      />
    </>
  );
}
