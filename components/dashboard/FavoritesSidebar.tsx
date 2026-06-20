"use client";

import { Star, X } from "lucide-react";

interface FavoritesSidebarProps {
  favorites: string[];
  activeContract: string | null;
  onSelect: (contractId: string) => void;
  onRemove: (contractId: string) => void;
}

export function FavoritesSidebar({
  favorites,
  activeContract,
  onSelect,
  onRemove,
}: FavoritesSidebarProps): React.JSX.Element | null {
  if (favorites.length === 0) return null;

  return (
    <aside aria-label="Pinned contracts" className="mb-4">
      <div className="flex items-center gap-1.5 mb-2">
        <Star className="h-3.5 w-3.5 text-amber-400 fill-amber-400" />
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Pinned
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {favorites.map((id) => {
          const isActive = activeContract === id;
          return (
            <div
              key={id}
              className={`group flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-mono transition-colors cursor-pointer select-none ${
                isActive
                  ? "border-violet-400 bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200 dark:border-violet-600"
                  : "border-border bg-muted/40 hover:border-violet-300 hover:bg-violet-50 dark:hover:bg-violet-950/40"
              }`}
              onClick={() => onSelect(id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && onSelect(id)}
              aria-label={`Load contract ${id}`}
              aria-pressed={isActive}
            >
              {id.slice(0, 6)}...{id.slice(-4)}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(id);
                }}
                className="ml-0.5 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                aria-label={`Unpin contract ${id}`}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
