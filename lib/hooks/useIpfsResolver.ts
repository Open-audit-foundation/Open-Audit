"use client";

import { useEffect, useState } from "react";

/** Returns true when a raw event field looks like an offloaded IPFS pointer. */
export function isIpfsPointer(value: string): boolean {
  return typeof value === "string" && value.startsWith("ipfs://");
}

/** The `{ data, topics }` payload restored from IPFS, matching lib/ipfs/offloader's OffloadablePayload. */
export interface ResolvedIpfsPayload {
  data: string;
  topics: string[];
}

export interface IpfsResolverState {
  payload: ResolvedIpfsPayload | null;
  loading: boolean;
  error: string | null;
}

/**
 * Resolves an `ipfs://<cid>` pointer back to the original offloaded
 * `{ data, topics }` payload via the `/api/ipfs/[cid]` proxy route.
 * Passing a non-pointer value is a no-op.
 */
export function useIpfsResolver(pointer: string | null | undefined): IpfsResolverState {
  const [state, setState] = useState<IpfsResolverState>({
    payload: null,
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (!pointer || !isIpfsPointer(pointer)) {
      setState({ payload: null, loading: false, error: null });
      return;
    }

    const cid = pointer.replace(/^ipfs:\/\//, "");
    let cancelled = false;
    setState({ payload: null, loading: true, error: null });

    fetch(`/api/ipfs/${encodeURIComponent(cid)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((payload: ResolvedIpfsPayload) => {
        if (!cancelled) setState({ payload, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({
            payload: null,
            loading: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [pointer]);

  return state;
}
