/**
 * Lightweight client for communicating with a local Kubo (go-ipfs) RPC API.
 *
 * Expects a running IPFS daemon at IPFS_API_URL (default http://127.0.0.1:5001).
 * All operations are best-effort: failures are logged and the caller should
 * fall back to storing data inline.
 */

const IPFS_API_URL =
  process.env.IPFS_API_URL ?? "http://127.0.0.1:5001";

const IPFS_GATEWAY_URL =
  process.env.IPFS_GATEWAY_URL ?? "http://127.0.0.1:8080";

async function ipfsFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const url = `${IPFS_API_URL}/api/v0/${path}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    ...options,
  });
  if (!res.ok) {
    throw new Error(`IPFS API error ${res.status}: ${res.statusText}`);
  }
  return res;
}

export interface IpfsAddResult {
  Hash: string;
  Size: string;
}

export async function add(
  content: string,
  pin: boolean = true
): Promise<IpfsAddResult | null> {
  try {
    const params = new URLSearchParams({ "pin": String(pin) });
    const res = await ipfsFetch(`add?${params}`, {
      method: "POST",
      body: content,
      headers: { "Content-Type": "application/octet-stream" },
    });
    const text = await res.text();
    const lines = text.trim().split("\n");
    return JSON.parse(lines[lines.length - 1]) as IpfsAddResult;
  } catch (err) {
    console.warn("[ipfs] add failed (best-effort):", err);
    return null;
  }
}

export async function cat(cid: string): Promise<string | null> {
  try {
    const params = new URLSearchParams({ "arg": cid });
    const res = await ipfsFetch(`cat?${params}`);
    return await res.text();
  } catch (err) {
    console.warn(`[ipfs] cat failed for ${cid} (best-effort):`, err);
    return null;
  }
}

export async function pin(cid: string): Promise<boolean> {
  try {
    const params = new URLSearchParams({ "arg": cid });
    await ipfsFetch(`pin/add?${params}`, { method: "POST" });
    return true;
  } catch (err) {
    console.warn(`[ipfs] pin failed for ${cid} (best-effort):`, err);
    return false;
  }
}

export async function resolveFromGateway(cid: string): Promise<string | null> {
  try {
    const url = `${IPFS_GATEWAY_URL}/ipfs/${cid}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    return await res.text();
  } catch (err) {
    console.warn(`[ipfs] gateway resolve failed for ${cid}:`, err);
    return null;
  }
}

export async function isReachable(): Promise<boolean> {
  try {
    await ipfsFetch("id");
    return true;
  } catch {
    return false;
  }
}
