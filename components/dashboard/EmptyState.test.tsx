import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("renders the waiting message", () => {
    render(<EmptyState cause="waiting" />);

    expect(screen.getByRole("status")).toHaveTextContent("No events found");
    expect(screen.getByText("Waiting for events on the Stellar network...")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear search" })).not.toBeInTheDocument();
  });

  it("renders the filtered message and clear action", () => {
    const onClearSearch = vi.fn();

    render(<EmptyState cause="filtered" onClearSearch={onClearSearch} />);

    expect(screen.getByText("No events match your search.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(onClearSearch).toHaveBeenCalledTimes(1);
  });

  it("renders the connection error message", () => {
    render(<EmptyState cause="connection-error" />);

    expect(screen.getByText("Could not connect to Stellar. Retrying...")).toBeInTheDocument();
  });
});
