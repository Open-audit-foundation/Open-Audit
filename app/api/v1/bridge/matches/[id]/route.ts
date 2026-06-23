/**
 * GET /api/v1/bridge/matches/[id]
 *
 * Returns a single CrossChainMatch with all linked BridgeEvent details.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const match = await db.crossChainMatch.findUnique({
    where: { id: params.id },
    include: {
      events: true,
    },
  });

  if (!match) {
    return NextResponse.json({ error: "Match not found" }, { status: 404 });
  }

  return NextResponse.json({ data: match });
}
