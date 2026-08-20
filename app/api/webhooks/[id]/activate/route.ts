/**
 * Webhook Activation API
 * POST /api/webhooks/:id/activate  Reactivate a deactivated subscription
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const existing = await db.webhookSubscription.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Webhook subscription not found" },
        { status: 404 }
      );
    }

    if (existing.isActive) {
      return NextResponse.json(
        {
          message: "Subscription is already active",
          subscription: {
            id: existing.id,
            isActive: existing.isActive,
          },
        },
        { status: 409 }
      );
    }

    const updated = await db.webhookSubscription.update({
      where: { id },
      data: {
        isActive: true,
        updatedAt: new Date(),
      },
      select: {
        id: true,
        url: true,
        contractId: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({
      success: true,
      message: "Webhook subscription activated",
      subscription: updated,
    });
  } catch (error) {
    console.error("[webhooks/:id/activate] POST Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
