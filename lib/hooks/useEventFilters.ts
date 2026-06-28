"use client";

import { useCallback, useMemo } from "react";
import { useUrlSync } from "@/lib/hooks/useUrlSync";

export interface EventFilters {
  contractId?: string;
  eventType?: string;
  network?: string;
  minAmount?: number;
  startLedger?: number;
  endLedger?: number;
  page: number;
}

export interface EventFilterParams {
  contractId?: string | null;
  eventType?: string | null;
  network?: string | null;
  minAmount?: string | null;
  startLedger?: string | null;
  endLedger?: string | null;
  page?: string | null;
}

export function parseNumber(value: string | null): number | undefined {
  if (!value?.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseEventFilterParams(raw: EventFilterParams): EventFilters {
  const page = parseNumber(raw.page ?? null);
  return {
    contractId: raw.contractId || undefined,
    eventType: raw.eventType || undefined,
    network: raw.network || undefined,
    minAmount: parseNumber(raw.minAmount ?? null),
    startLedger: parseNumber(raw.startLedger ?? null),
    endLedger: parseNumber(raw.endLedger ?? null),
    page: page && page >= 1 ? page : 1,
  };
}

export function useEventFilters() {
  const urlSync = useUrlSync();

  const contractId = urlSync.get("contractId");
  const eventType = urlSync.get("eventType");
  const network = urlSync.get("network");
  const minAmountRaw = urlSync.get("minAmount");
  const startLedgerRaw = urlSync.get("startLedger");
  const endLedgerRaw = urlSync.get("endLedger");
  const pageRaw = urlSync.get("page");

  const filters = useMemo(
    function () {
      return parseEventFilterParams({
        contractId,
        eventType,
        network,
        minAmount: minAmountRaw,
        startLedger: startLedgerRaw,
        endLedger: endLedgerRaw,
        page: pageRaw,
      });
    },
    [contractId, eventType, network, minAmountRaw, startLedgerRaw, endLedgerRaw, pageRaw]
  );

  const setFilters = useCallback(
    function (updates: EventFilterParams): void {
      urlSync.setParams(updates);
    },
    [urlSync]
  );

  const setPage = useCallback(
    function (page: number): void {
      urlSync.setParams({ page: String(page) });
    },
    [urlSync]
  );

  const clearAll = useCallback(
    function (): void {
      urlSync.setParams({
        contractId: null,
        eventType: null,
        network: null,
        minAmount: null,
        startLedger: null,
        endLedger: null,
        page: null,
      });
    },
    [urlSync]
  );

  return {
    filters,
    rawParams: {
      contractId,
      eventType,
      network,
      minAmount: minAmountRaw,
      startLedger: startLedgerRaw,
      endLedger: endLedgerRaw,
      page: pageRaw,
    },
    setFilters,
    setPage,
    clearAll,
  };
}
