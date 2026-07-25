"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocalStorage } from "./useLocalStorage";

export type Density = "compact" | "comfortable";

export interface ColumnVisibility {
  status: boolean;
  time: boolean;
  description: boolean;
  contract: boolean;
  actions: boolean;
}

export interface DashboardPrefs {
  density: Density;
  columns: ColumnVisibility;
  favorites: string[]; // contract IDs
}

const DEFAULT_PREFS: DashboardPrefs = {
  density: "comfortable",
  columns: {
    status: true,
    time: true,
    description: true,
    contract: true,
    actions: true,
  },
  favorites: [],
};

const STORAGE_KEY = "oa:dashboard-prefs";

function load(): DashboardPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    // Merge so new keys from DEFAULT_PREFS are always present
    const saved = JSON.parse(raw) as Partial<DashboardPrefs>;
    return {
      ...DEFAULT_PREFS,
      ...saved,
      columns: { ...DEFAULT_PREFS.columns, ...(saved.columns ?? {}) },
      favorites: saved.favorites ?? [],
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function save(prefs: DashboardPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // storage quota or private browsing — silently degrade
  }
}

export function useDashboardPrefs() {
  // Start with defaults to avoid hydration mismatch, then load from storage
  const [prefs, setPrefs] = useState<DashboardPrefs>(DEFAULT_PREFS);
  const [ready, setReady] = useState(false);

  useEffect(function () {
    setPrefs(load());
    setReady(true);
  }, []);

  const update = useCallback(function (patch: Partial<DashboardPrefs>) {
    setPrefs(function (prev) {
      const next = {
        ...prev,
        ...patch,
        columns: { ...prev.columns, ...(patch.columns ?? {}) },
      };
      save(next);
      return next;
    });
  }, []);

  const toggleColumn = useCallback(function (col: keyof ColumnVisibility) {
    setPrefs(function (prev) {
      const next = {
        ...prev,
        columns: { ...prev.columns, [col]: !prev.columns[col] },
      };
      save(next);
      return next;
    });
  }, []);

  const toggleFavorite = useCallback(function (contractId: string) {
    setPrefs(function (prev) {
      const exists = prev.favorites.includes(contractId);
      const favorites = exists
        ? prev.favorites.filter((id) => id !== contractId)
        : [...prev.favorites, contractId];
      const next = { ...prev, favorites };
      save(next);
      return next;
    });
  }, []);

  return { prefs, ready, update, toggleColumn, toggleFavorite };
}
