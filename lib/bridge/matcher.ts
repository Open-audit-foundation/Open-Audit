/**
 * Cross-Chain Bridge Matcher
 *
 * Deterministically pairs a Soroban Burn event with its corresponding EVM
 * Mint event using a tiered matching strategy:
 *
 *   Tier 1 — destinationProof/nonce exact match    (confidence 100)
 *   Tier 2 — amount + recipient + ≤10 min window   (confidence 85)
 *   Tier 3 — amount + ≤10 min window               (confidence 65)
 *
 * Matched pairs are persisted as CrossChainMatch rows; unmatched burns are
 * re-queued for up to MATCH_TIMEOUT_SECONDS before being marked "unmatched".
 */

import { db } from "@/lib/db/client";
import type { RawBridgeEvent, MatchMethod } from "./types";

// Maximum seconds between a burn and its expected mint before we give up
const MATCH_TIMEOUT_SECONDS = 30 * 60; // 30 minutes

// Tolerance for timestamp-based matching
const TIMESTAMP_TOLERANCE_SECONDS = 10 * 60; // 10 minutes

interface MatchResult {
  matched: boolean;
  matchId?: string;
  confidence?: number;
  method?: MatchMethod;
}

/**
 * Attempt to match a newly ingested bridge event against existing unmatched
 * events on the opposite chain.
 *
 * For a BURN   — search for a pending MINT from the destination chain.
 * For a MINT   — search for a pending BURN from Stellar that awaits this mint.
 */
export async function matchBridgeEvent(
  event: RawBridgeEvent,
  persistedEventId: string
): Promise<MatchResult> {
  const oppositeType = event.eventType === "burn" ? "mint" : "burn";

  // ─────────────────────────────────────────────────────────────────────────
  // Tier 1: exact destinationProof / nonce match
  // ─────────────────────────────────────────────────────────────────────────
  if (event.destinationProof) {
    const counterpart = await db.bridgeEvent.findFirst({
      where: {
        eventType: oppositeType,
        destinationProof: event.destinationProof,
        matchId: null,
      },
    });

    if (counterpart) {
      return persistMatch(event, persistedEventId, counterpart.id, 100, "proof");
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Tier 2: amount + recipient within ±10 min
  // ─────────────────────────────────────────────────────────────────────────
  if (event.recipient && event.amount) {
    const lo = event.timestamp - TIMESTAMP_TOLERANCE_SECONDS;
    const hi = event.timestamp + TIMESTAMP_TOLERANCE_SECONDS;

    const counterpart = await db.bridgeEvent.findFirst({
      where: {
        eventType: oppositeType,
        amount: event.amount,
        recipient: event.recipient,
        timestamp: { gte: lo, lte: hi },
        matchId: null,
      },
      orderBy: { timestamp: "asc" },
    });

    if (counterpart) {
      return persistMatch(event, persistedEventId, counterpart.id, 85, "amount+recipient");
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Tier 3: amount only within ±10 min
  // ─────────────────────────────────────────────────────────────────────────
  if (event.amount) {
    const lo = event.timestamp - TIMESTAMP_TOLERANCE_SECONDS;
    const hi = event.timestamp + TIMESTAMP_TOLERANCE_SECONDS;

    const counterpart = await db.bridgeEvent.findFirst({
      where: {
        eventType: oppositeType,
        amount: event.amount,
        timestamp: { gte: lo, lte: hi },
        matchId: null,
      },
      orderBy: { timestamp: "asc" },
    });

    if (counterpart) {
      return persistMatch(event, persistedEventId, counterpart.id, 65, "amount+timestamp");
    }
  }

  // No match yet — the event is recorded as a pending burn/mint
  return { matched: false };
}

/** Create or update the CrossChainMatch record binding the two events. */
async function persistMatch(
  incoming: RawBridgeEvent,
  incomingId: string,
  counterpartId: string,
  confidence: number,
  method: MatchMethod
): Promise<MatchResult> {
  const counterpart = await db.bridgeEvent.findUnique({
    where: { id: counterpartId },
  });

  if (!counterpart) return { matched: false };

  const burnEvent  = incoming.eventType === "burn" ? incoming : null;
  const mintEvent  = incoming.eventType === "mint" ? incoming : null;
  const burnDbId   = incoming.eventType === "burn" ? incomingId : counterpartId;
  const mintDbId   = incoming.eventType === "mint" ? incomingId : counterpartId;

  const burnTs = burnEvent ? burnEvent.timestamp : (counterpart.timestamp as number);
  const mintTs = mintEvent ? mintEvent.timestamp : (counterpart.timestamp as number);
  const latency = mintTs - burnTs;

  // Create the match record
  const match = await db.crossChainMatch.create({
    data: {
      status: "matched",
      burnTxHash: burnEvent?.txHash ?? counterpart.txHash,
      mintTxHash: mintEvent?.txHash ?? counterpart.txHash,
      burnChain: burnEvent?.chain ?? (counterpart.chain as string),
      mintChain: mintEvent?.chain ?? (counterpart.chain as string),
      token: incoming.token ?? counterpart.token ?? null,
      amount: incoming.amount,
      sender: incoming.sender ?? counterpart.sender ?? null,
      recipient: incoming.recipient ?? counterpart.recipient ?? null,
      burnTimestamp: burnTs,
      mintTimestamp: mintTs,
      latencySeconds: latency,
      destinationProof: incoming.destinationProof ?? counterpart.destinationProof ?? null,
      matchConfidence: confidence,
      matchMethod: method,
    },
  });

  // Link both BridgeEvent rows to this match
  await db.bridgeEvent.updateMany({
    where: { id: { in: [burnDbId, mintDbId] } },
    data: { matchId: match.id },
  });

  return { matched: true, matchId: match.id, confidence, method };
}

/**
 * Scan for burns that have exceeded the match timeout and mark them
 * "unmatched". Called periodically by the EVM indexer worker.
 */
export async function expireUnmatchedBurns(): Promise<number> {
  const cutoff = Math.floor(Date.now() / 1000) - MATCH_TIMEOUT_SECONDS;

  // Find pending burns with no match that are older than the timeout
  const stale = await db.bridgeEvent.findMany({
    where: {
      eventType: "burn",
      matchId: null,
      timestamp: { lt: cutoff },
    },
    select: { id: true, txHash: true, amount: true, timestamp: true, chain: true, destinationChain: true },
  });

  if (stale.length === 0) return 0;

  // Create "unmatched" records for each
  for (const burn of stale) {
    const match = await db.crossChainMatch.create({
      data: {
        status: "unmatched",
        burnTxHash: burn.txHash,
        mintTxHash: null,
        burnChain: burn.chain,
        mintChain: burn.destinationChain ?? "ethereum",
        amount: burn.amount,
        burnTimestamp: burn.timestamp,
        matchConfidence: 0,
      },
    });
    await db.bridgeEvent.update({
      where: { id: burn.id },
      data: { matchId: match.id },
    });
  }

  return stale.length;
}
