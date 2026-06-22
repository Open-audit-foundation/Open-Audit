/**
 * IPFS CID Resolver API
 * POST /api/ipfs/resolve
 *
 * Resolves an IPFS CID (with or without "ipfs:" prefix) and returns
 * the stored content as plain text. Used by the frontend to asynchronously
 * display bloated event metadata that was offloaded during ingestion.
 */

import { NextRequest, NextResponse } from "next/server";
import { extractCid, resolveFromIpfs } from "@/lib/ipfs/offloader";
import { isIpfsPointer } from "@/lib/ipfs/offloader";

export async function POST(request: NextRequest) {
  try {
    const body: { cid?: string; pointer?: string } = await request.json();
    const input = body.cid ?? body.pointer ?? "";

    if (!input) {
      return NextResponse.json(
        { error: "Missing 'cid' or 'pointer' in request body" },
        { status: 400 }
      );
    }

    let cid = input;
    if (isIpfsPointer(input)) {
      const extracted = extractCid(input);
      if (!extracted) {
        return NextResponse.json(
          { error: "Invalid IPFS pointer format" },
          { status: 400 }
        );
      }
      cid = extracted;
    }

    const content = await resolveFromIpfs(cid);

    if (content === null) {
      return NextResponse.json(
        {
          error: "Failed to resolve CID from IPFS node or gateway",
          cid,
        },
        { status: 404 }
      );
    }

    return NextResponse.json({ cid, content });
  } catch (error) {
    console.error("[ipfs/resolve] Error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to resolve CID",
      },
      { status: 500 }
    );
  }
}
