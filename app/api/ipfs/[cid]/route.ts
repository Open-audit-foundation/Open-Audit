/**
 * GET /api/ipfs/[cid]
 *
 * Server-side proxy that resolves a CID previously produced by
 * lib/ipfs/offloader.ts back into its original `{ data, topics }` payload.
 * The dashboard fetches through this route (rather than hitting IPFS
 * directly from the browser) so the Kubo API URL never has to be exposed
 * client-side and gateway fallback stays server-controlled.
 */

import { NextResponse } from "next/server";
import { retrieveIpfsPayload } from "@/lib/ipfs/offloader";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ cid: string }> }
): Promise<NextResponse> {
  const { cid } = await params;

  if (!cid) {
    return NextResponse.json({ error: "Missing CID" }, { status: 400 });
  }

  try {
    const payload = await retrieveIpfsPayload(cid);
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "public, max-age=31536000, immutable" },
    });
  } catch (err) {
    console.warn(`[api/ipfs] Failed to resolve CID ${cid}:`, err);
    return NextResponse.json(
      { error: "IPFS content unavailable", cid },
      { status: 502 }
    );
  }
}
