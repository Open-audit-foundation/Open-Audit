"use client";

import { useEffect, useReducer, useCallback, useState } from "react";
import type { ExecutionDag } from "../dag/types";
import { dagFromJson, type ExecutionDagJson } from "../dag/types";

// ── State machine ─────────────────────────────────────────────────────────────

interface State {
  dag: ExecutionDag | null;
  loading: boolean;
  error: string | null;
}

type Action =
  | { type: "FETCH_START" }
  | { type: "FETCH_SUCCESS"; dag: ExecutionDag }
  | { type: "FETCH_ERROR"; error: string }
  | { type: "RESET" };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "FETCH_START":
      return { dag: null, loading: true, error: null };
    case "FETCH_SUCCESS":
      return { dag: action.dag, loading: false, error: null };
    case "FETCH_ERROR":
      return { dag: null, loading: false, error: action.error };
    case "RESET":
      return { dag: null, loading: false, error: null };
    default:
      return state;
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface UseExecutionDagResult {
  dag: ExecutionDag | null;
  loading: boolean;
  error: string | null;
  /** Re-fetch the DAG for the current txHash. */
  refetch: () => void;
}

/**
 * Fetch and memoize the execution DAG for a Soroban transaction.
 *
 * @param txHash - The 64-char hex transaction hash. Pass `null` to skip.
 */
export function useExecutionDag(txHash: string | null): UseExecutionDagResult {
  const [state, dispatch] = useReducer(reducer, {
    dag: null,
    loading: false,
    error: null,
  });

  // Incrementing this causes the effect to re-run (genuine state, not a ref).
  const [fetchEpoch, setFetchEpoch] = useState(0);

  useEffect(() => {
    if (!txHash) {
      dispatch({ type: "RESET" });
      return;
    }

    let cancelled = false;
    dispatch({ type: "FETCH_START" });

    (async () => {
      try {
        const resp = await fetch(`/api/v1/dag/${encodeURIComponent(txHash)}`);
        if (!resp.ok) {
          const body = await resp.text().catch(() => resp.statusText);
          if (!cancelled) {
            dispatch({ type: "FETCH_ERROR", error: `HTTP ${resp.status}: ${body}` });
          }
          return;
        }

        const json: ExecutionDagJson = await resp.json();
        if (!cancelled) {
          dispatch({ type: "FETCH_SUCCESS", dag: dagFromJson(json) });
        }
      } catch (err) {
        if (!cancelled) {
          dispatch({
            type: "FETCH_ERROR",
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    })();

    return () => { cancelled = true; };
  }, [txHash, fetchEpoch]);

  const refetch = useCallback(() => {
    setFetchEpoch((n) => n + 1);
  }, []);

  return { ...state, refetch };
}
