/**
 * Search-result highlighting in the event feed.
 *
 * Highlighting is what tells the user *why* a row matched, so it needs to be
 * correct about which substrings it marks — and it must not throw on a query
 * containing regex metacharacters, which contract and function names routinely
 * do (`transfer(`, `a.b`, `x[0]`).
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { EventFeedTable } from "./EventFeedTable";
import type { TranslatedEvent } from "@/lib/translator/types";

function makeEvent(
  id: string,
  description: string,
  eventType = "transfer"
): TranslatedEvent {
  return {
    raw: {
      id,
      contractId: "CONTRACT_A",
      topics: [eventType],
      data: "0x00",
      ledger: 1,
      timestamp: new Date("2026-01-01T00:00:00.000Z").toISOString(),
      txHash: `tx_${id}`,
    },
    status: "translated",
    eventType,
    description,
  } as unknown as TranslatedEvent;
}

const columns = {
  timestamp: true,
  contract: true,
  description: true,
  status: true,
  tx: true,
} as never;

function renderTable(events: TranslatedEvent[], highlightQuery?: string) {
  return render(
    <EventFeedTable
      events={events}
      columns={columns}
      density="comfortable"
      onToggleColumn={vi.fn()}
      onDensityChange={vi.fn()}
      highlightQuery={highlightQuery}
    />
  );
}

afterEach(cleanup);

describe("event feed highlighting", () => {
  it("marks the matching substring in the description", () => {
    renderTable([makeEvent("e1", "Transferred 100 tokens")], "tokens");

    const marks = screen.getAllByTestId("search-highlight");
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe("tokens");
  });

  it("matches case-insensitively but preserves the original casing", () => {
    renderTable([makeEvent("e1", "Transferred 100 Tokens")], "tokens");

    const mark = screen.getAllByTestId("search-highlight")[0];
    expect(mark.textContent).toBe("Tokens");
  });

  it("marks every occurrence, not only the first", () => {
    renderTable([makeEvent("e1", "swap then swap again")], "swap");
    expect(screen.getAllByTestId("search-highlight")).toHaveLength(2);
  });

  it("highlights the event type as well as the description", () => {
    renderTable([makeEvent("e1", "nothing relevant", "transfer")], "transfer");

    const marks = screen.getAllByTestId("search-highlight");
    expect(marks.some((m) => m.textContent === "transfer")).toBe(true);
  });

  it("renders no marks without a query", () => {
    renderTable([makeEvent("e1", "Transferred 100 tokens")]);
    expect(screen.queryAllByTestId("search-highlight")).toHaveLength(0);
  });

  it("renders no marks for a whitespace-only query", () => {
    renderTable([makeEvent("e1", "Transferred 100 tokens")], "   ");
    expect(screen.queryAllByTestId("search-highlight")).toHaveLength(0);
  });

  it("renders no marks when the query does not occur in the text", () => {
    renderTable([makeEvent("e1", "Transferred 100 tokens")], "zzzz");
    expect(screen.queryAllByTestId("search-highlight")).toHaveLength(0);
  });

  it("does not throw on a query containing regex metacharacters", () => {
    // Unescaped, `transfer(` is an unterminated group and would throw.
    expect(() =>
      renderTable([makeEvent("e1", "called transfer( on the contract")], "transfer(")
    ).not.toThrow();

    expect(screen.getAllByTestId("search-highlight")[0].textContent).toBe("transfer(");
  });

  it("leaves the surrounding text intact", () => {
    renderTable([makeEvent("e1", "Transferred 100 tokens")], "100");

    // The full sentence still reads correctly once the mark is inlined.
    expect(screen.getByText(/Transferred/).textContent).toBe("Transferred 100 tokens");
  });
});
