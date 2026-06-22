"use client";

import { useState, useEffect } from "react";
import { isIpfsPointer, extractCid } from "@/lib/ipfs/offloader";

interface IpfsResolveResult {
  content: string | null;
  loading: boolean;
  error: string | null;
}

const resolveCache: Record<string, string> = {};

async function fetchFromApi(cid: string): Promise<string | null> {
  if (resolveCache[cid]) return resolveCache[cid];

  try {
    const res = await fetch("/api/ipfs/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cid }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.content) {
      resolveCache[cid] = data.content;
    }
    return data.content ?? null;
  } catch {
    return null;
  }
}

export function useIpfsResolver(value: string | undefined | null): IpfsResolveResult {
  const [result, setResult] = useState<IpfsResolveResult>({
    content: null,
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (!value) {
      setResult({ content: null, loading: false, error: null });
      return;
    }

    if (!isIpfsPointer(value)) {
      setResult({ content: value, loading: false, error: null });
      return;
    }

    const cid = extractCid(value);
    if (!cid) {
      setResult({ content: value, loading: false, error: null });
      return;
    }

    if (resolveCache[cid]) {
      setResult({ content: resolveCache[cid], loading: false, error: null });
      return;
    }

    let cancelled = false;
    setResult({ content: null, loading: true, error: null });

    fetchFromApi(cid).then((content) => {
      if (cancelled) return;
      if (content) {
        setResult({ content, loading: false, error: null });
      } else {
        setResult({
          content: null,
          loading: false,
          error: "Failed to resolve IPFS content",
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [value]);

  return result;
}
