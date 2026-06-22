/**
 * Webhooks API
 *
 * GET /api/v1/webhooks?contractId=... - List webhooks for a contract
 * POST /api/v1/webhooks - Create a new webhook subscription
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { authenticateAndRateLimit } from "@/lib/api/middleware";
import { toErrorResponse, validationErrorResponse } from "@/lib/api/error-response";
import crypto from "crypto";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const authError = await authenticateAndRateLimit(request);
    if (authError) return authError;

    const { searchParams } = request.nextUrl;
    const contractId = searchParams.get("contractId");

    if (!contractId) return validationErrorResponse("contractId is required");

    const webhooks = await db.webhookSubscription.findMany({
      where: { contractId },
      include: {
        _count: {
          select: { webhookDeliveries: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(webhooks);
  } catch (error) {
    return toErrorResponse(error, { fallbackMessage: "Failed to fetch webhooks" });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const authError = await authenticateAndRateLimit(request);
    if (authError) return authError;

    const body = await request.json();
    const { name, url, contractId, eventTypes } = body;

    if (!url) return validationErrorResponse("url is required");
    if (!contractId) return validationErrorResponse("contractId is required");

    // Generate a secure secret
    const secret = crypto.randomBytes(32).toString("hex");

    const webhook = await db.webhookSubscription.create({
      data: {
        name,
        url,
        contractId,
        secret,
        eventTypes: eventTypes || null,
        enabled: true,
      },
    });

    return NextResponse.json(webhook, { status: 201 });
  } catch (error) {
    return toErrorResponse(error, { fallbackMessage: "Failed to create webhook" });
  }
}
