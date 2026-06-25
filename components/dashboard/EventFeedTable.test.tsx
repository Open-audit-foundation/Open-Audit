import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { axe } from "vitest-axe";
import { EventFeedTable } from "./EventFeedTable";

vi.mock("react-syntax-highlighter", () => ({
  Prism: () => <div data-testid="mock-syntax-highlighter" />
}));

describe("EventFeedTable Accessibility", () => {
  it("should have no accessibility violations", async () => {
    const mockEvents = [
      {
        status: "translated" as const,
        description: "Transferred 100 XLM to Bob",
        eventType: "transfer",
        blueprintName: "Mock Blueprint",
        schemaVersion: "test",
        raw: {
          id: "1",
          type: "contract",
          ledger: 123456,
          ledgerClosedAt: "2026-06-17T17:11:21Z",
          contractId: "CAAA...D2KM",
          pagingToken: "token",
          txHash: "hash123",
          topics: ["topic1"],
          data: "data123",
          timestamp: Date.now() / 1000 - 3600,
        },
      },
      {
        status: "cryptic" as const,
        description: "",
        eventType: "",
        blueprintName: null,
        schemaVersion: null,
        raw: {
          id: "2",
          type: "contract",
          ledger: 123456,
          ledgerClosedAt: "2026-06-17T17:11:21Z",
          contractId: "CAAA...D2KM",
          pagingToken: "token",
          txHash: "hash456",
          topics: ["topic2"],
          data: "data456",
          timestamp: Date.now() / 1000 - 7200,
        },
      },
    ];

    const columns = {
      status: true,
      time: true,
      description: true,
      contract: true,
      actions: true,
    };

    const { container } = render(
      <EventFeedTable
        events={mockEvents}
        columns={columns}
        density="comfortable"
        onToggleColumn={vi.fn()}
        onDensityChange={vi.fn()}
      />
    );

    const results = await axe(container);
    expect(results.violations).toHaveLength(0);
  });

  it("renders the skeleton while loading", () => {
    const columns = {
      status: true,
      time: true,
      description: true,
      contract: true,
      actions: true,
    };

    render(
      <EventFeedTable
        events={[]}
        isLoading={true}
        columns={columns}
        density="comfortable"
        onToggleColumn={vi.fn()}
        onDensityChange={vi.fn()}
      />
    );

    expect(screen.getByLabelText("Loading events")).toHaveAttribute("aria-busy", "true");
  });

  it("renders filtered empty state and clear action", () => {
    const columns = {
      status: true,
      time: true,
      description: true,
      contract: true,
      actions: true,
    };
    const onClearSearch = vi.fn();

    render(
      <EventFeedTable
        events={[]}
        emptyStateCause="filtered"
        columns={columns}
        density="comfortable"
        onToggleColumn={vi.fn()}
        onDensityChange={vi.fn()}
        onClearSearch={onClearSearch}
      />
    );

    expect(screen.getByText("No events match your search.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(onClearSearch).toHaveBeenCalledTimes(1);
  });

  it("renders connection error empty state", () => {
    const columns = {
      status: true,
      time: true,
      description: true,
      contract: true,
      actions: true,
    };

    render(
      <EventFeedTable
        events={[]}
        emptyStateCause="connection-error"
        columns={columns}
        density="comfortable"
        onToggleColumn={vi.fn()}
        onDensityChange={vi.fn()}
      />
    );

    expect(screen.getByText("Could not connect to Stellar. Retrying...")).toBeInTheDocument();
  });
});
