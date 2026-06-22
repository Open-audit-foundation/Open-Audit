/**
 * GET /api/v1/events/proof
 *
 * Returns a Stellar Merkle inclusion proof for a specific transaction,
 * allowing the client to verify that the event was finalized on-chain
 * without trusting the Open-Audit backend.
 *
 * Query params:
 *   txHash   64-character lowercase hex transaction hash (required)
 *   ledger   positive integer ledger sequence number (required)
 *   network  testnet | mainnet | futurenet (default: testnet)
 *
 * Response 200:
 *   { proof: InclusionProof }
 *
 * Response 400: invalid params
 * Response 404: transaction not found in the specified ledger
 * Response 502: Horizon unavailable or returned an error
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchInclusionProof } from "@/lib/stellar/stellar-proof";

const TX_HASH_RE = /^[0-9a-f]{64}$/i;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;

  // ── Parameter validation ──────────────────────────────────────────────────

  const txHash = params.get("txHash") ?? "";
  if (!TX_HASH_RE.test(txHash)) {
    return NextResponse.json(
      {
        error:
          "Invalid txHash. Must be exactly 64 lowercase hex characters (a Stellar transaction hash).",
      },
      { status: 400 }
    );
  }

  const ledgerParam = params.get("ledger") ?? "";
  const ledger = parseInt(ledgerParam, 10);
  if (!ledgerParam || isNaN(ledger) || ledger < 1) {
    return NextResponse.json(
      {
        error:
          "Invalid ledger. Must be a positive integer representing the Stellar ledger sequence number.",
      },
      { status: 400 }
    );
  }

  const network = params.get("network") ?? "testnet";
  if (!["testnet", "mainnet", "futurenet"].includes(network)) {
    return NextResponse.json(
      { error: "Invalid network. Must be one of: testnet, mainnet, futurenet." },
      { status: 400 }
    );
  }

  // ── Proof fetch ───────────────────────────────────────────────────────────

  try {
    const proof = await fetchInclusionProof(txHash.toLowerCase(), ledger, network);

    // Ledger data is immutable once finalised — cache aggressively
    return NextResponse.json(
      { proof },
      {
        status: 200,
        headers: {
          "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
          "X-Proof-Ledger": String(ledger),
          "X-Proof-Network": network,
        },
      }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error fetching proof";

    // Distinguish between "not found" and upstream errors
    if (
      message.includes("not found") ||
      message.includes("different ledger") ||
      message.includes("no tx_set_hash")
    ) {
      return NextResponse.json({ error: message }, { status: 404 });
    }

    if (message.includes("too many transactions")) {
      return NextResponse.json({ error: message }, { status: 422 });
    }

    console.error("[proof] Failed to fetch inclusion proof:", message);
    return NextResponse.json(
      { error: `Failed to fetch proof from Stellar network: ${message}` },
      { status: 502 }
    );
  }
}
