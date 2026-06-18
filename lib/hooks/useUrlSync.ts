"use client";

import { useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type ParamUpdates = Record<string, string | null | undefined>;

interface UrlSync {
  /** Read the current value of a single search param. Empty string if absent. */
  get: (key: string) => string;
  /** Replace one or more search params. Empty/null/undefined values remove the key. */
  setParams: (updates: ParamUpdates) => void;
}

/**
 * Small wrapper around next/navigation's useSearchParams + useRouter for
 * mirroring component state to the URL. Uses router.replace so filter changes
 * don't pile up in browser history.
 */
export function useUrlSync(): UrlSync {
  const router = useRouter();
  const searchParams = useSearchParams();

  const get = useCallback(
    function (key: string): string {
      return searchParams?.get(key) ?? "";
    },
    [searchParams]
  );

  // setParams reads from window.location each call rather than closing over
  // searchParams. Keeps the callback identity stable so consumers can put it
  // in effect deps without infinite re-runs.
  const setParams = useCallback(
    function (updates: ParamUpdates): void {
      if (typeof window === "undefined") return;
      const current = new URLSearchParams(window.location.search);
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === undefined || value === "") {
          current.delete(key);
        } else {
          current.set(key, value);
        }
      }
      const qs = current.toString();
      const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
      router.replace(url, { scroll: false });
    },
    [router]
  );

  return { get, setParams };
}
