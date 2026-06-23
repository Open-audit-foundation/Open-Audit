/**
 * Stellar/Soroban Bridge Burn Listener
 *
 * Hooks into the existing event stream (already indexed by src/worker/indexer.ts)
 * and extracts bridge Burn events so they can be fed into the cross-chain matcher.
 *
 * The listener looks for events whose eventType is "burn" AND whose contractId
 * is one of the configured bridge contracts.  It then upserts a BridgeEvent row
 * and calls the matcher.
 */

import { db } from "@/lib/db/client";
import { matchBridgeEvent } from "./matcher";
import type { RawBridgeEvent } from "./types";
import type { TranslatedEvent } from "@/lib/translator/types";

/** Bridge contract IDs on Stellar that we are watching. */
const STELLAR_BRIDGE_CONTRACT_IDS = (
  process.env.STELLAR_BRIDGE_CONTRACT_IDS ?? ""
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * Extract a destination-chain proof / nonce from the raw event topics.
 * Bridge contracts typically emit the nonce as topics[2] or in the data field.
 */
function extractDestinationProof(event: TranslatedEvent): string | undefined {
  // Attempt to extract from topics[2] (common convention)
  const topic = event.raw.topics[2];
  if (topic && topic.length === 66) return topic; // 32-byte hex
  return undefined;
}

/**
 * Extract the destination chain name from topics[3] or data if present.
 * Returns "ethereum" as a safe default.
 */
function extractDestinationChain(event: TranslatedEvent): string {
  const topic = event.raw.topics[3];
  if (!topic) return "ethereum";
  // The topic value encodes the chain as a number — map common chain IDs
  const chainId = parseInt(topic.slice(-8), 16);
  const map: Record<number, string> = {
    1:     "ethereum",
    10:    "optimism",
    42161: "arbitrum",
    8453:  "base",
  };
  return map[chainId] ?? "ethereum";
}

/**
 * Process a translated Soroban event.
 * Only acts when the event originates from a bridge contract and is a burn.
 */
export async function handleStellarBridgeEvent(
  event: TranslatedEvent
): Promise<void> {
  const { raw } = event;

  // Filter: only process burn events from configured bridge contracts
  const isBridgeContract =
    STELLAR_BRIDGE_CONTRACT_IDS.length === 0 ||
    STELLAR_BRIDGE_CONTRACT_IDS.includes(raw.contractId);

  if (!isBridgeContract) return;
  if (event.eventType?.toLowerCase() !== "burn") return;

  const destinationProof = extractDestinationProof(event);
  const destinationChain = extractDestinationChain(event);

  // Amount is typically encoded in data or topics[1]
  const rawAmount = raw.data && raw.data !== "0x" ? raw.data : "0";
  const amount = (() => {
    try {
      return BigInt(rawAmount).toString();
    } catch {
      return rawAmount;
    }
  })();

  const bridgeEvent: RawBridgeEvent = {
    chain: "stellar",
    eventType: "burn",
    txHash: raw.txHash,
    blockNumber: BigInt(raw.ledger),
    timestamp: raw.timestamp,
    contractAddress: raw.contractId,
    destinationChain,
    destinationProof,
    amount,
    rawPayload: { topics: raw.topics, data: raw.data, ledger: raw.ledger },
  };

  // Upsert to avoid double-insertion if the event is replayed on restart
  const existing = await db.bridgeEvent.findFirst({
    where: { txHash: raw.txHash, eventType: "burn", chain: "stellar" },
  });

  if (existing) return; // already processed

  const persisted = await db.bridgeEvent.create({
    data: {
      chain: bridgeEvent.chain,
      eventType: bridgeEvent.eventType,
      txHash: bridgeEvent.txHash,
      blockNumber: bridgeEvent.blockNumber,
      timestamp: bridgeEvent.timestamp,
      contractAddress: bridgeEvent.contractAddress,
      sender: bridgeEvent.sender ?? null,
      recipient: bridgeEvent.recipient ?? null,
      token: bridgeEvent.token ?? null,
      amount: bridgeEvent.amount,
      destinationChain: bridgeEvent.destinationChain ?? null,
      destinationProof: bridgeEvent.destinationProof ?? null,
      rawPayload: bridgeEvent.rawPayload,
    },
  });

  await matchBridgeEvent(bridgeEvent, persisted.id);
}
