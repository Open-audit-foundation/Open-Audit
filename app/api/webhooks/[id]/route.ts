/**
 * Individual Webhook Subscription API
 * GET    /api/webhooks/:id          Get a subscription by ID
 * DELETE /api/webhooks/:id          Delete a subscription
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  try {
    const subscription = await db.webhookSubscription.findUnique({
      where: { id },
      select: {
        id: true,
        url: true,
        contractId: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!subscription) {
      return NextResponse.json(
        { error: "Webhook subscription not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(subscription);
  } catch (error) {
    console.error("[webhooks/:id] GET Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  try {
    const existing = await db.webhookSubscription.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Webhook subscription not found" },
        { status: 404 }
      );
    }

    await db.webhookSubscription.delete({
      where: { id },
    });

    return NextResponse.json({
      success: true,
      message: "Webhook subscription deleted",
    });
  } catch (error) {
    console.error("[webhooks/:id] DELETE Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
