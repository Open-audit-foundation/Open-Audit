"use client";

import * as React from "react";
import { Radio, Search, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type EmptyStateCause = "waiting" | "filtered" | "connection-error";

interface EmptyStateProps {
  cause: EmptyStateCause;
  onClearSearch?: () => void;
  className?: string;
}

const COPY: Record<
  EmptyStateCause,
  {
    title: string;
    description: string;
    icon: typeof Search;
  }
> = {
  waiting: {
    title: "No events found",
    description: "Waiting for events on the Stellar network...",
    icon: Radio,
  },
  filtered: {
    title: "No events found",
    description: "No events match your search.",
    icon: Search,
  },
  "connection-error": {
    title: "No events found",
    description: "Could not connect to Stellar. Retrying...",
    icon: WifiOff,
  },
};

export function EmptyState({
  cause,
  onClearSearch,
  className,
}: EmptyStateProps): React.JSX.Element {
  const { title, description, icon: Icon } = COPY[cause];

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "mx-auto flex min-h-[220px] max-w-md flex-col items-center justify-center px-6 py-10 text-center",
        className
      )}
    >
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full border bg-muted/40 text-violet-600 dark:text-violet-400">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </div>
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
      {cause === "filtered" && onClearSearch && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-5"
          onClick={onClearSearch}
        >
          Clear search
        </Button>
      )}
    </div>
  );
}
