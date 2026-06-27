/**
 * GET /api/webhooks/[id]/deliveries — delivery history for a subscription
 *
 * Returns paginated WebhookDelivery records including status codes and
 * attempt counts, ordered newest first.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";

type Params = Promise<{ id: string }>;

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

export async function GET(
  request: NextRequest,
  props: { params: Params }
): Promise<NextResponse> {
  const { id } = await props.params;
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
    // Verify the subscription exists
    const subscription = await db.webhookSubscription.findUnique({
      where: { id },
      select: { id: true, url: true, contractId: true, active: true },
    });

    if (!subscription) {
      return NextResponse.json(
        { error: "Not Found", message: `No subscription found with id '${id}'.` },
        { status: 404 }
      );
    }

    const [total, deliveries] = await Promise.all([
      db.webhookDelivery.count({ where: { subscriptionId: id } }),
      db.webhookDelivery.findMany({
        where: { subscriptionId: id },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { deliveredAt: "desc" },
        select: {
          id: true,
          subscriptionId: true,
          statusCode: true,
          success: true,
          attemptCount: true,
          deliveredAt: true,
          // payload excluded from list to keep response lean
        },
      }),
    ]);

    return NextResponse.json({
      subscription,
      data: deliveries,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (err) {
    console.error(`[GET /api/webhooks/${id}/deliveries] DB error:`, err);
    return NextResponse.json(
      {
        error: "Internal Server Error",
        message: "Failed to fetch delivery history.",
      },
      { status: 500 }
    );
  }
}
