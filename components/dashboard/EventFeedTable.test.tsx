import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { axe } from "vitest-axe";
import { EventFeedTable } from "./EventFeedTable";
import type { TranslatedEvent, ColumnVisibility } from "@/lib/translator/types";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("react-syntax-highlighter", () => ({
  Prism: () => <div data-testid="mock-syntax-highlighter" />,
}));

vi.mock("./EventDetailsModal", () => ({
  EventDetailsModal: ({
    open,
    event,
  }: {
    open: boolean;
    event: TranslatedEvent | null;
  }) =>
    open ? (
      <div data-testid="mock-event-details-modal" data-event-id={event?.raw.id} />
    ) : null,
}));

vi.mock("./ContributeDialog", () => ({
  ContributeDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="mock-contribute-dialog" /> : null,
}));

vi.mock("@/lib/translator/decode", () => ({
  formatRelativeTime: (_ts: number) => "1h ago",
  truncateHex: (hex: string, _chars?: number) => hex.slice(0, 10) + "...",
}));

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const NOW_S = Math.floor(Date.now() / 1000);

const translatedEvent: TranslatedEvent = {
  status: "translated",
  description: "Public Key [GABC...1234] transferred 100 USDC to [GXYZ...5678]",
  eventType: "transfer",
  blueprintName: "Stellar Asset Contract (SAC)",
  schemaVersion: "v1",
  raw: {
    id: "event-1",
    contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
    topics: ["topic1"],
    data: "0xdeadbeef01",
    ledger: 100,
    timestamp: NOW_S - 3600,
    txHash: "txhash-translated-001",
  },
};

const crypticEvent: TranslatedEvent = {
  status: "cryptic",
  description: null,
  eventType: null,
  blueprintName: null,
  schemaVersion: null,
  raw: {
    id: "event-2",
    contractId: "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB2KM",
    topics: ["topic2"],
    data: "0xcafebabe99",
    ledger: 101,
    timestamp: NOW_S - 7200,
    txHash: "txhash-cryptic-002",
  },
};

const pendingEvent: TranslatedEvent = {
  status: "pending",
  description: null,
  eventType: null,
  blueprintName: null,
  schemaVersion: null,
  raw: {
    id: "event-3",
    contractId: "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC2KM",
    topics: ["topic3"],
    data: "0x1234567890",
    ledger: 102,
    timestamp: NOW_S - 1800,
    txHash: "txhash-pending-003",
  },
};

const defaultColumns: ColumnVisibility = {
  status: true,
  time: true,
  description: true,
  contract: true,
  actions: true,
};

function renderTable(
  overrides: Partial<Parameters<typeof EventFeedTable>[0]> = {}
) {
  const props = {
    events: [translatedEvent, crypticEvent],
    columns: defaultColumns,
    density: "comfortable" as const,
    onToggleColumn: vi.fn(),
    onDensityChange: vi.fn(),
    ...overrides,
  };
  return render(<EventFeedTable {...props} />);
}

// ---------------------------------------------------------------------------
// Accessibility
// ---------------------------------------------------------------------------

describe("EventFeedTable Accessibility", () => {
  it("should have no accessibility violations with translated and cryptic events", async () => {
    const { container } = renderTable();
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("should have no accessibility violations in loading state", async () => {
    const { container } = renderTable({ events: [], isLoading: true });
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("should have no accessibility violations in empty state", async () => {
    const { container } = renderTable({ events: [] });
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

// ---------------------------------------------------------------------------
// Translated event rendering
// ---------------------------------------------------------------------------

describe("EventFeedTable – translated event rendering", () => {
  it("renders the translated status badge", () => {
    renderTable({ events: [translatedEvent] });
    expect(screen.getByText("Translated")).toBeInTheDocument();
  });

  it("renders the event description", () => {
    renderTable({ events: [translatedEvent] });
    expect(
      screen.getByText(
        "Public Key [GABC...1234] transferred 100 USDC to [GXYZ...5678]"
      )
    ).toBeInTheDocument();
  });

  it("renders the eventType label in uppercase", () => {
    renderTable({ events: [translatedEvent] });
    // The component renders event.eventType in a span inside the description cell
    expect(screen.getByText("transfer")).toBeInTheDocument();
  });

  it("does NOT render 'No translation available' for a translated event", () => {
    renderTable({ events: [translatedEvent] });
    expect(
      screen.queryByText(/No translation available/i)
    ).not.toBeInTheDocument();
  });

  it("does NOT render the Contribute button for a translated event", () => {
    renderTable({ events: [translatedEvent] });
    expect(
      screen.queryByRole("button", { name: /contribute translation for event event-1/i })
    ).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Cryptic event rendering
// ---------------------------------------------------------------------------

describe("EventFeedTable – cryptic event rendering", () => {
  it("renders the cryptic status badge", () => {
    renderTable({ events: [crypticEvent] });
    expect(screen.getByText("Cryptic")).toBeInTheDocument();
  });

  it("renders the 'No translation available' fallback text", () => {
    renderTable({ events: [crypticEvent] });
    expect(
      screen.getByText(/No translation available for this event/i)
    ).toBeInTheDocument();
  });

  it("renders truncated hex data below the fallback text", () => {
    renderTable({ events: [crypticEvent] });
    // truncateHex mock: hex.slice(0, 10) + "..."
    // "0xcafebabe99".slice(0, 10) === "0xcafebabe"
    expect(screen.getByText(/0xcafebabe\.\.\./i)).toBeInTheDocument();
  });

  it("renders the Contribute button for a cryptic event", () => {
    renderTable({ events: [crypticEvent] });
    expect(
      screen.getByRole("button", {
        name: /contribute translation for event event-2/i,
      })
    ).toBeInTheDocument();
  });

  it("does NOT render description text for a cryptic event", () => {
    renderTable({ events: [crypticEvent] });
    // The description field is null for cryptic; no description paragraph
    expect(
      screen.queryByText(
        "Public Key [GABC...1234] transferred 100 USDC to [GXYZ...5678]"
      )
    ).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Pending event rendering
// ---------------------------------------------------------------------------

describe("EventFeedTable – pending event rendering", () => {
  it("renders the Pending status badge", () => {
    renderTable({ events: [pendingEvent] });
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("renders the Contribute button for a pending event (not translated)", () => {
    renderTable({ events: [pendingEvent] });
    expect(
      screen.getByRole("button", {
        name: /contribute translation for event event-3/i,
      })
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Loading state
// ---------------------------------------------------------------------------

describe("EventFeedTable – loading state", () => {
  it("renders skeleton rows instead of event rows when isLoading is true", () => {
    const { container } = renderTable({ events: [], isLoading: true });
    // SkeletonRow renders a div with animate-pulse class inside each cell
    const skeletonDivs = container.querySelectorAll(".animate-pulse");
    // 5 skeleton rows × visibleColCount(5) = 25 cells
    expect(skeletonDivs.length).toBe(25);
  });

  it("does NOT render event data when loading", () => {
    renderTable({ events: [translatedEvent], isLoading: true });
    expect(screen.queryByText("Translated")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/transferred 100 USDC/i)
    ).not.toBeInTheDocument();
  });

  it("does NOT render the empty state message when loading", () => {
    renderTable({ events: [], isLoading: true });
    expect(
      screen.queryByText(/No events found/i)
    ).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

describe("EventFeedTable – empty state", () => {
  it("renders the empty state message when events is empty and not loading", () => {
    renderTable({ events: [] });
    expect(
      screen.getByText(/No events found. Enter a Contract ID above to search./i)
    ).toBeInTheDocument();
  });

  it("does NOT render skeleton rows in the empty state", () => {
    const { container } = renderTable({ events: [] });
    expect(container.querySelectorAll(".animate-pulse").length).toBe(0);
  });

  it("does NOT render the empty state when there are events", () => {
    renderTable({ events: [translatedEvent] });
    expect(screen.queryByText(/No events found/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// newEventIds highlight animation
// ---------------------------------------------------------------------------

describe("EventFeedTable – newEventIds highlight", () => {
  it("adds animate-slide-in class to rows whose id is in newEventIds", () => {
    const { container } = renderTable({
      events: [translatedEvent, crypticEvent],
      newEventIds: new Set(["event-1"]),
    });

    const rows = container.querySelectorAll("tbody tr");
    // First row should have the animation class
    expect(rows[0].className).toMatch(/animate-slide-in/);
  });

  it("does NOT add animate-slide-in class to rows NOT in newEventIds", () => {
    const { container } = renderTable({
      events: [translatedEvent, crypticEvent],
      newEventIds: new Set(["event-1"]),
    });

    const rows = container.querySelectorAll("tbody tr");
    // Second row (event-2) should NOT have the animation class
    expect(rows[1].className).not.toMatch(/animate-slide-in/);
  });

  it("does NOT apply highlight when newEventIds is empty", () => {
    const { container } = renderTable({
      events: [translatedEvent],
      newEventIds: new Set(),
    });

    const rows = container.querySelectorAll("tbody tr");
    expect(rows[0].className).not.toMatch(/animate-slide-in/);
  });

  it("applies highlight to multiple events when all are in newEventIds", () => {
    const { container } = renderTable({
      events: [translatedEvent, crypticEvent],
      newEventIds: new Set(["event-1", "event-2"]),
    });

    const rows = container.querySelectorAll("tbody tr");
    expect(rows[0].className).toMatch(/animate-slide-in/);
    expect(rows[1].className).toMatch(/animate-slide-in/);
  });
});

// ---------------------------------------------------------------------------
// Column visibility
// ---------------------------------------------------------------------------

describe("EventFeedTable – column visibility", () => {
  it("hides the Status column when columns.status is false", () => {
    renderTable({
      events: [translatedEvent],
      columns: { ...defaultColumns, status: false },
    });
    expect(screen.queryByText("Status")).not.toBeInTheDocument();
    // The badge itself should also be absent
    expect(screen.queryByText("Translated")).not.toBeInTheDocument();
  });

  it("hides the Time column when columns.time is false", () => {
    renderTable({
      events: [translatedEvent],
      columns: { ...defaultColumns, time: false },
    });
    expect(screen.queryByText("Time")).not.toBeInTheDocument();
    // formatRelativeTime mock returns "1h ago" — should not appear
    expect(screen.queryByText("1h ago")).not.toBeInTheDocument();
  });

  it("hides the Description column when columns.description is false", () => {
    renderTable({
      events: [translatedEvent],
      columns: { ...defaultColumns, description: false },
    });
    expect(screen.queryByText("Translated Description")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/transferred 100 USDC/i)
    ).not.toBeInTheDocument();
  });

  it("hides the Actions column when columns.actions is false", () => {
    renderTable({
      events: [translatedEvent],
      columns: { ...defaultColumns, actions: false },
    });
    expect(screen.queryByText("Actions")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /view event details/i })
    ).not.toBeInTheDocument();
  });

  it("calls onToggleColumn with the correct key when a column checkbox is toggled", () => {
    const onToggleColumn = vi.fn();
    renderTable({ onToggleColumn });

    // Open the column menu
    fireEvent.click(
      screen.getByRole("button", { name: /toggle column visibility/i })
    );

    // Click the "Status" checkbox label
    const statusCheckbox = screen.getByRole("checkbox", { name: /status/i });
    fireEvent.click(statusCheckbox);

    expect(onToggleColumn).toHaveBeenCalledWith("status");
  });

  it("calls onToggleColumn with the correct key for the Description column", () => {
    const onToggleColumn = vi.fn();
    renderTable({ onToggleColumn });

    fireEvent.click(
      screen.getByRole("button", { name: /toggle column visibility/i })
    );

    const descriptionCheckbox = screen.getByRole("checkbox", {
      name: /description/i,
    });
    fireEvent.click(descriptionCheckbox);

    expect(onToggleColumn).toHaveBeenCalledWith("description");
  });

  it("renders all column headers when all columns are visible", () => {
    renderTable();
    expect(screen.getByText("Status")).toBeInTheDocument();
    expect(screen.getByText("Time")).toBeInTheDocument();
    expect(screen.getByText("Translated Description")).toBeInTheDocument();
    expect(screen.getByText("Actions")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Density toggle
// ---------------------------------------------------------------------------

describe("EventFeedTable – density toggle", () => {
  it("calls onDensityChange with 'compact' when compact button is clicked", () => {
    const onDensityChange = vi.fn();
    renderTable({ onDensityChange });

    fireEvent.click(screen.getByRole("button", { name: /compact/i }));
    expect(onDensityChange).toHaveBeenCalledWith("compact");
  });

  it("calls onDensityChange with 'comfortable' when comfortable button is clicked", () => {
    const onDensityChange = vi.fn();
    renderTable({ density: "compact", onDensityChange });

    fireEvent.click(screen.getByRole("button", { name: /comfortable/i }));
    expect(onDensityChange).toHaveBeenCalledWith("comfortable");
  });
});

// ---------------------------------------------------------------------------
// Action buttons
// ---------------------------------------------------------------------------

describe("EventFeedTable – action buttons", () => {
  it("renders a 'View Details' button for each event", () => {
    renderTable({ events: [translatedEvent, crypticEvent] });

    const viewButtons = screen.getAllByRole("button", {
      name: /view event details/i,
    });
    expect(viewButtons).toHaveLength(2);
  });

  it("opens the EventDetailsModal when View Details is clicked", () => {
    renderTable({ events: [translatedEvent] });

    fireEvent.click(
      screen.getByRole("button", {
        name: /view event details for event event-1/i,
      })
    );

    expect(screen.getByTestId("mock-event-details-modal")).toBeInTheDocument();
  });

  it("opens the ContributeDialog when Contribute is clicked on a cryptic event", () => {
    renderTable({ events: [crypticEvent] });

    fireEvent.click(
      screen.getByRole("button", {
        name: /contribute translation for event event-2/i,
      })
    );

    expect(screen.getByTestId("mock-contribute-dialog")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Multiple events mixed
// ---------------------------------------------------------------------------

describe("EventFeedTable – mixed event list", () => {
  it("renders both translated and cryptic events in the same table", () => {
    renderTable({ events: [translatedEvent, crypticEvent] });

    expect(screen.getByText("Translated")).toBeInTheDocument();
    expect(screen.getByText("Cryptic")).toBeInTheDocument();
    expect(
      screen.getByText(/transferred 100 USDC/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/No translation available/i)
    ).toBeInTheDocument();
  });

  it("renders the correct number of table rows for the event list", () => {
    const { container } = renderTable({
      events: [translatedEvent, crypticEvent, pendingEvent],
    });
    // tbody rows; each event maps to one row
    const rows = container.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(3);
  });

  it("formats the relative time for each event using formatRelativeTime", () => {
    renderTable({ events: [translatedEvent, crypticEvent] });
    // Our mock returns "1h ago" for every event
    const timeLabels = screen.getAllByText("1h ago");
    expect(timeLabels).toHaveLength(2);
  });
});
