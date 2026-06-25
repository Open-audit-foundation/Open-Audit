"use client";

import * as React from "react";
import {
  TableBody,
  TableCell,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { ColumnVisibility, Density } from "@/lib/hooks/useDashboardPrefs";

interface EventListSkeletonProps {
  columns: ColumnVisibility;
  density: Density;
  rowCount?: number;
}

function SkeletonBlock({ className }: { className: string }): React.JSX.Element {
  return (
    <div
      className={cn(
        "animate-pulse rounded bg-muted motion-reduce:animate-none",
        className
      )}
    />
  );
}

function SkeletonRow({
  columns,
  density,
}: {
  columns: ColumnVisibility;
  density: Density;
}): React.JSX.Element {
  const cellPadding = density === "compact" ? "py-2" : "py-3";

  return (
    <TableRow className="hover:bg-transparent" aria-hidden="true">
      {columns.status && (
        <TableCell className={cellPadding}>
          <SkeletonBlock className="h-6 w-24 rounded-full" />
        </TableCell>
      )}

      {columns.time && (
        <TableCell className={cellPadding}>
          <SkeletonBlock className="h-3 w-16" />
        </TableCell>
      )}

      {columns.description && (
        <TableCell className={cellPadding}>
          <div className="space-y-2">
            <SkeletonBlock className="h-3 w-20" />
            <SkeletonBlock className="h-4 w-full max-w-[420px]" />
          </div>
        </TableCell>
      )}

      {columns.contract && (
        <TableCell className={cn(cellPadding, "hidden md:table-cell")}>
          <SkeletonBlock className="h-4 w-28" />
        </TableCell>
      )}

      {columns.actions && (
        <TableCell className={cn(cellPadding, "text-right")}>
          <div className="flex justify-end gap-2">
            <SkeletonBlock className="h-8 w-24" />
            <SkeletonBlock className="h-8 w-20" />
          </div>
        </TableCell>
      )}
    </TableRow>
  );
}

export function EventListSkeleton({
  columns,
  density,
  rowCount = 6,
}: EventListSkeletonProps): React.JSX.Element {
  return (
    <TableBody aria-busy="true" aria-live="polite" aria-label="Loading events">
      <TableRow className="sr-only">
        <TableCell>Loading events</TableCell>
      </TableRow>
      {Array.from({ length: rowCount }).map(function (_, index) {
        return <SkeletonRow key={index} columns={columns} density={density} />;
      })}
    </TableBody>
  );
}
