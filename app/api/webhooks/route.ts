/**
 * Webhook Subscription Management API
 * GET  /api/webhooks          List all subscriptions
 * POST /api/webhooks          Register a new subscription
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { validateWebhookUrl } from "@/lib/webhooks/ssrf-protection";
import { generateWebhookSecret } from "@/lib/webhooks/signing";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const contractId = searchParams.get("contractId");
    const isActiveStr = searchParams.get("isActive");

    const where: Record<string, unknown> = {};
    if (contractId) {
      where.contractId = contractId;
    }
    if (isActiveStr !== null) {
      where.isActive = isActiveStr === "true";
    }

    const subscriptions = await db.webhookSubscription.findMany({
      where: Object.keys(where).length ? where : undefined,
      orderBy: { createdAt: "desc" },
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
      count: subscriptions.length,
      subscriptions,
    });
  } catch (error) {
    console.error("[webhooks] GET Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const { url, contractId } = body;

    if (!url || typeof url !== "string") {
      return NextResponse.json(
        { error: "URL is required" },
        { status: 400 }
      );
    }

    if (contractId !== undefined && contractId !== null && typeof contractId !== "string") {
      return NextResponse.json(
        { error: "contractId must be a string" },
        { status: 400 }
      );
    }

    const ssrfResult = await validateWebhookUrl(url);
    if (!ssrfResult.valid) {
      return NextResponse.json(
        { error: ssrfResult.error ?? "URL failed SSRF validation" },
        { status: 400 }
      );
    }

    const secret = generateWebhookSecret();

    const subscription = await db.webhookSubscription.create({
      data: {
        url,
        contractId: contractId ?? null,
        secretHash: secret,
        isActive: true,
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

    return NextResponse.json(
      {
        subscription,
        secret,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[webhooks] POST Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
