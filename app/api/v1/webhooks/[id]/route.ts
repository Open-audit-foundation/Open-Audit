/**
 * Webhook by ID API
 *
 * GET /api/v1/webhooks/[id] - Get a single webhook
 * PUT /api/v1/webhooks/[id] - Update a webhook
 * DELETE /api/v1/webhooks/[id] - Delete a webhook
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { authenticateAndRateLimit } from "@/lib/api/middleware";
import { toErrorResponse, validationErrorResponse } from "@/lib/api/error-response";
import crypto from "crypto";

type Params = Promise<{ id: string }>;

export async function GET(request: NextRequest, props: { params: Params }): Promise<NextResponse> {
  try {
    const params = await props.params;
    const authError = await authenticateAndRateLimit(request);
    if (authError) return authError;

    const webhook = await db.webhookSubscription.findUnique({
      where: { id: params.id },
      include: {
        webhookDeliveries: {
          take: 20,
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!webhook) {
      return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
    }

    return NextResponse.json(webhook);
  } catch (error) {
    return toErrorResponse(error, { fallbackMessage: "Failed to fetch webhook" });
  }
}

export async function PUT(request: NextRequest, props: { params: Params }): Promise<NextResponse> {
  try {
    const params = await props.params;
    const authError = await authenticateAndRateLimit(request);
    if (authError) return authError;

    const body = await request.json();
    const { name, url, eventTypes, enabled, rotateSecret } = body;

    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (url !== undefined) updateData.url = url;
    if (eventTypes !== undefined) updateData.eventTypes = eventTypes;
    if (enabled !== undefined) updateData.enabled = enabled;
    if (rotateSecret === true) {
      updateData.secret = crypto.randomBytes(32).toString("hex");
    }

    const webhook = await db.webhookSubscription.update({
      where: { id: params.id },
      data: updateData,
    });

    return NextResponse.json(webhook);
  } catch (error) {
    return toErrorResponse(error, { fallbackMessage: "Failed to update webhook" });
  }
}

export async function DELETE(request: NextRequest, props: { params: Params }): Promise<NextResponse> {
  try {
    const params = await props.params;
    const authError = await authenticateAndRateLimit(request);
    if (authError) return authError;

    await db.webhookSubscription.delete({
      where: { id: params.id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return toErrorResponse(error, { fallbackMessage: "Failed to delete webhook" });
  }
}
