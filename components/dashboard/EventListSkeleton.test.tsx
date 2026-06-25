import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  Table,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EventListSkeleton } from "./EventListSkeleton";
import type { ColumnVisibility } from "@/lib/hooks/useDashboardPrefs";

const columns: ColumnVisibility = {
  status: true,
  time: true,
  description: true,
  contract: true,
  actions: true,
};

describe("EventListSkeleton", () => {
  it("renders an accessible busy table body with placeholder rows", () => {
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Status</TableHead>
            <TableHead>Time</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Contract</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <EventListSkeleton columns={columns} density="comfortable" rowCount={6} />
      </Table>
    );

    expect(screen.getByLabelText("Loading events")).toHaveAttribute("aria-busy", "true");
    expect(screen.getAllByRole("row", { hidden: true })).toHaveLength(8);
  });
});
