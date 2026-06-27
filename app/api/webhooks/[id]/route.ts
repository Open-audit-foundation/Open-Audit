/**
 * DELETE /api/webhooks/[id] — deactivate a subscription (sets active: false)
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";

type Params = Promise<{ id: string }>;

export async function DELETE(
  _request: NextRequest,
  props: { params: Params }
): Promise<NextResponse> {
  const { id } = await props.params;

  try {
    const existing = await db.webhookSubscription.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Not Found", message: `No subscription found with id '${id}'.` },
        { status: 404 }
      );
    }

    await db.webhookSubscription.update({
      where: { id },
      data: { active: false },
    });

    return NextResponse.json(
      { id, active: false, message: "Subscription deactivated." },
      { status: 200 }
    );
  } catch (err) {
    console.error(`[DELETE /api/webhooks/${id}] DB error:`, err);
    return NextResponse.json(
      {
        error: "Internal Server Error",
        message: "Failed to deactivate subscription.",
      },
      { status: 500 }
    );
  }
}
