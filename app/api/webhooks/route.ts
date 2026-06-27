/**
 * POST /api/webhooks  — register a new webhook subscription
 * GET  /api/webhooks  — list all subscriptions (paginated)
 */

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { db } from "@/lib/db/client";
import { validateWebhookUrl, validateContractId } from "@/lib/webhooks/validate";
import {
  checkWebhookRegistrationRateLimit,
  getClientIp,
} from "@/lib/webhooks/ip-rate-limit";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

// ── POST /api/webhooks ────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Per-IP rate limit: 10 registrations per hour
  const allowed = await checkWebhookRegistrationRateLimit(request);
  if (!allowed) {
    return NextResponse.json(
      {
        error: "Too Many Requests",
        message:
          "Webhook registration limit reached — maximum 10 subscriptions per IP per hour.",
      },
      {
        status: 429,
        headers: { "Retry-After": "3600" },
      }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Bad Request", message: "Request body must be valid JSON." },
      { status: 400 }
    );
  }

  const { url, contractId } = body as Record<string, unknown>;

  // Validate required fields
  if (!url || typeof url !== "string") {
    return NextResponse.json(
      { error: "Bad Request", message: "url is required." },
      { status: 400 }
    );
  }
  if (!contractId || typeof contractId !== "string") {
    return NextResponse.json(
      { error: "Bad Request", message: "contractId is required." },
      { status: 400 }
    );
  }

  // Validate URL (SSRF protection)
  const urlCheck = validateWebhookUrl(url);
  if (!urlCheck.valid) {
    return NextResponse.json(
      { error: "Bad Request", message: urlCheck.error },
      { status: 400 }
    );
  }

  // Validate Stellar contract ID format
  const contractCheck = validateContractId(contractId);
  if (!contractCheck.valid) {
    return NextResponse.json(
      { error: "Bad Request", message: contractCheck.error },
      { status: 400 }
    );
  }

  // Generate a cryptographically-random signing secret (shown only once)
  const secret = randomBytes(32).toString("hex");

  try {
    const subscription = await db.webhookSubscription.create({
      data: {
        url,
        contractId,
        secret,
        active: true,
      },
      select: {
        id: true,
        url: true,
        contractId: true,
        active: true,
        createdAt: true,
        // secret is included in the CREATE response only
        secret: true,
      },
    });

    return NextResponse.json(
      {
        id: subscription.id,
        url: subscription.url,
        contractId: subscription.contractId,
        active: subscription.active,
        createdAt: subscription.createdAt,
        // Signing secret — shown only once. Store it securely.
        secret: subscription.secret,
        _notice:
          "The secret will not be returned again. Store it securely to verify X-Open-Audit-Signature headers.",
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("[POST /api/webhooks] DB error:", err);
    return NextResponse.json(
      { error: "Internal Server Error", message: "Failed to create subscription." },
      { status: 500 }
    );
  }
}

// ── GET /api/webhooks ─────────────────────────────────────────────────────────

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = request.nextUrl;

  const rawPage = parseInt(searchParams.get("page") ?? "1", 10);
  const rawPageSize = parseInt(
    searchParams.get("pageSize") ?? String(DEFAULT_PAGE_SIZE),
    10
  );

  const page = isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;
  const pageSize =
    isNaN(rawPageSize) || rawPageSize < 1
      ? DEFAULT_PAGE_SIZE
      : Math.min(rawPageSize, MAX_PAGE_SIZE);

  try {
    const [total, subscriptions] = await Promise.all([
      db.webhookSubscription.count(),
      db.webhookSubscription.findMany({
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          url: true,
          contractId: true,
          active: true,
          createdAt: true,
          // Never return the secret in list responses
        },
      }),
    ]);

    return NextResponse.json({
      data: subscriptions,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (err) {
    console.error("[GET /api/webhooks] DB error:", err);
    return NextResponse.json(
      { error: "Internal Server Error", message: "Failed to list subscriptions." },
      { status: 500 }
    );
  }
}
