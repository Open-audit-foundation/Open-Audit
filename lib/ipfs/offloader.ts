/**
 * IPFS Offloader — identifies bloated metadata strings inside raw events
 * during the ingestion phase and offloads them to a local IPFS node.
 *
 * A hex string is considered "bloated" when its decoded byte length exceeds
 * BLOAT_THRESHOLD (default 2048 bytes).
 *
 * Offloaded values are replaced with a lightweight IPFS CID pointer of the form
 * `ipfs:<CID>` so the primary database stays lean.
 */

import * as ipfs from "./client";
import type { RawEvent } from "../translator/types";

export const BLOAT_THRESHOLD = 2048;
const IPFS_PREFIX = "ipfs:";

export function isIpfsPointer(value: string): boolean {
  return value.startsWith(IPFS_PREFIX);
}

export function extractCid(pointer: string): string | null {
  if (!pointer.startsWith(IPFS_PREFIX)) return null;
  return pointer.slice(IPFS_PREFIX.length);
}

function hexByteLength(hex: string): number {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  return Math.ceil(clean.length / 2);
}

export function isBloated(hexString: string): boolean {
  return hexByteLength(hexString) > BLOAT_THRESHOLD;
}

export async function offloadToIpfs(
  hexString: string
): Promise<string> {
  const cid = await ipfs.add(hexString, true);
  if (cid && cid.Hash) {
    await ipfs.pin(cid.Hash);
    return `${IPFS_PREFIX}${cid.Hash}`;
  }
  return hexString;
}

export async function resolveFromIpfs(
  pointer: string
): Promise<string | null> {
  const cid = extractCid(pointer);
  if (!cid) return null;
  return await ipfs.cat(cid) ?? await ipfs.resolveFromGateway(cid);
}

export function buildIpfsPointer(cid: string): string {
  return `${IPFS_PREFIX}${cid}`;
}

export interface ProcessedIpfsResult {
  data: string;
  topics: string[];
  cids: string[];
}

export async function processEventForIpfs(
  event: RawEvent
): Promise<ProcessedIpfsResult> {
  const cids: string[] = [];
  let data = event.data;
  const topics = [...event.topics];

  if (isBloated(data)) {
    const pointer = await offloadToIpfs(data);
    if (pointer !== data) {
      data = pointer;
      const cid = extractCid(pointer);
      if (cid) cids.push(cid);
    }
  }

  for (let i = 0; i < topics.length; i++) {
    if (isBloated(topics[i])) {
      const pointer = await offloadToIpfs(topics[i]);
      if (pointer !== topics[i]) {
        topics[i] = pointer;
        const cid = extractCid(pointer);
        if (cid) cids.push(cid);
      }
    }
  }

  return { data, topics, cids };
}
