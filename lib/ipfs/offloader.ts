/**
 * IPFS event offloader.
 *
 * Bloated Soroban event payloads (data + topics combined, hex-encoded) are
 * moved off the hot broadcast/storage path and into IPFS once they exceed a
 * configurable size threshold (default 2KB). The in-line `data`/`topics`
 * fields are then replaced with a single `ipfs://<cid>` pointer that the
 * dashboard resolves lazily.
 *
 * Backend: a local Kubo (go-ipfs) node's HTTP RPC API (`IPFS_API_URL`,
 * default http://127.0.0.1:5001 — start one with `ipfs daemon`). Kubo's API
 * is a small set of plain HTTP endpoints, so no additional IPFS client
 * dependency is needed — the platform `fetch` is enough.
 *
 * Offloading is an optimization, not a hard dependency: if IPFS is
 * unconfigured, unreachable, or the upload fails for any reason, the
 * failure is logged and the event is returned with its original inline
 * data untouched so translation/broadcast can proceed normally.
 */

import type { RawEvent } from "../translator/types";

/** Default offload threshold in bytes, matching the server.ts doc comment. */
const DEFAULT_THRESHOLD_BYTES = 2048;
/** Default per-request timeout for talking to the Kubo API. */
const DEFAULT_TIMEOUT_MS = 5000;

/** The subset of a RawEvent that gets offloaded and restored. */
export interface OffloadablePayload {
  data: string;
  topics: string[];
}

interface OffloaderConfig {
  apiUrl: string | null;
  gatewayUrl: string;
  thresholdBytes: number;
  timeoutMs: number;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getConfig(): OffloaderConfig {
  return {
    apiUrl: process.env.IPFS_API_URL || null,
    gatewayUrl: process.env.IPFS_GATEWAY_URL || "http://127.0.0.1:8080",
    thresholdBytes: parsePositiveInt(process.env.IPFS_OFFLOAD_THRESHOLD_BYTES, DEFAULT_THRESHOLD_BYTES),
    timeoutMs: parsePositiveInt(process.env.IPFS_UPLOAD_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
  };
}

function payloadSizeBytes(payload: OffloadablePayload): number {
  return Buffer.byteLength(JSON.stringify(payload), "utf-8");
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

async function withTimeout<T>(timeoutMs: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

/** Uploads a payload to Kubo's `/api/v0/add` endpoint and returns the resulting CID. */
async function uploadToIpfs(
  apiUrl: string,
  payload: OffloadablePayload,
  timeoutMs: number
): Promise<string> {
  return withTimeout(timeoutMs, async (signal) => {
    const body = new FormData();
    body.append("file", new Blob([JSON.stringify(payload)], { type: "application/json" }), "event.json");

    const response = await fetch(`${stripTrailingSlash(apiUrl)}/api/v0/add?pin=true`, {
      method: "POST",
      body,
      signal,
    });

    if (!response.ok) {
      throw new Error(`IPFS add failed with HTTP ${response.status}`);
    }

    const result = (await response.json()) as { Hash?: string };
    if (!result.Hash) {
      throw new Error("IPFS add response did not include a Hash");
    }

    return result.Hash;
  });
}

/**
 * Offloads an event's `data`/`topics` to IPFS when their combined serialized
 * size exceeds the configured threshold. Payloads under the threshold, and
 * any event when IPFS is unconfigured or the upload fails, pass through
 * with their original inline fields unchanged.
 */
export async function processEventForIpfs(rawEvent: RawEvent): Promise<OffloadablePayload> {
  const original: OffloadablePayload = { data: rawEvent.data, topics: rawEvent.topics };
  const config = getConfig();

  if (payloadSizeBytes(original) <= config.thresholdBytes) {
    return original;
  }

  if (!config.apiUrl) {
    return original;
  }

  try {
    const cid = await uploadToIpfs(config.apiUrl, original, config.timeoutMs);
    const pointer = `ipfs://${cid}`;
    return { data: pointer, topics: [pointer] };
  } catch (err) {
    console.warn(
      `[ipfs] Failed to offload event ${rawEvent.id} (contract ${rawEvent.contractId}), ` +
        `broadcasting inline instead: ${err instanceof Error ? err.message : String(err)}`
    );
    return original;
  }
}

/**
 * Fetches a previously offloaded payload back from IPFS by CID, trying the
 * local Kubo API first and falling back to the public gateway. Used by the
 * `/api/ipfs/[cid]` route that the dashboard resolves `ipfs://` pointers
 * through.
 */
export async function retrieveIpfsPayload(cid: string): Promise<OffloadablePayload> {
  const config = getConfig();
  const errors: string[] = [];

  if (config.apiUrl) {
    try {
      return await withTimeout(config.timeoutMs, async (signal) => {
        const response = await fetch(
          `${stripTrailingSlash(config.apiUrl as string)}/api/v0/cat?arg=${encodeURIComponent(cid)}`,
          { method: "POST", signal }
        );
        if (!response.ok) {
          throw new Error(`IPFS cat failed with HTTP ${response.status}`);
        }
        return (await response.json()) as OffloadablePayload;
      });
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  try {
    return await withTimeout(config.timeoutMs, async (signal) => {
      const response = await fetch(`${stripTrailingSlash(config.gatewayUrl)}/ipfs/${encodeURIComponent(cid)}`, {
        signal,
      });
      if (!response.ok) {
        throw new Error(`IPFS gateway fetch failed with HTTP ${response.status}`);
      }
      return (await response.json()) as OffloadablePayload;
    });
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    throw new Error(`Failed to retrieve IPFS content for CID ${cid}: ${errors.join("; ")}`);
  }
}
