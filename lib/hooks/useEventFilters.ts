"use client";

import { useCallback, useMemo } from "react";
import { useUrlSync } from "@/lib/hooks/useUrlSync";

export interface EventFilters {
  contractId?: string;
  eventType?: string;
  minAmount?: number;
  startLedger?: number;
  endLedger?: number;
}

export interface EventFilterParams {
  contractId?: string | null;
  eventType?: string | null;
  minAmount?: string | null;
  startLedger?: string | null;
  endLedger?: string | null;
}

export function parseNumber(value: string | null): number | undefined {
  if (!value?.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseEventFilterParams(raw: EventFilterParams): EventFilters {
  return {
    contractId: raw.contractId || undefined,
    eventType: raw.eventType || undefined,
    minAmount: parseNumber(raw.minAmount ?? null),
    startLedger: parseNumber(raw.startLedger ?? null),
    endLedger: parseNumber(raw.endLedger ?? null),
  };
}

export function useEventFilters() {
  const urlSync = useUrlSync();

  const contractId = urlSync.get("contractId");
  const eventType = urlSync.get("eventType");
  const minAmountRaw = urlSync.get("minAmount");
  const startLedgerRaw = urlSync.get("startLedger");
  const endLedgerRaw = urlSync.get("endLedger");

  const filters = useMemo(
    function () {
      return parseEventFilterParams({
        contractId,
        eventType,
        minAmount: minAmountRaw,
        startLedger: startLedgerRaw,
        endLedger: endLedgerRaw,
      });
    },
    [contractId, eventType, minAmountRaw, startLedgerRaw, endLedgerRaw]
  );

  const setFilters = useCallback(
    function (updates: EventFilterParams): void {
      urlSync.setParams(updates);
    },
    [urlSync]
  );

  const clearAll = useCallback(
    function (): void {
      urlSync.setParams({
        contractId: null,
        eventType: null,
        minAmount: null,
        startLedger: null,
        endLedger: null,
      });
    },
    [urlSync]
  );

  return {
    filters,
    rawParams: {
      contractId,
      eventType,
      minAmount: minAmountRaw,
      startLedger: startLedgerRaw,
      endLedger: endLedgerRaw,
    },
    setFilters,
    clearAll,
  };
}
