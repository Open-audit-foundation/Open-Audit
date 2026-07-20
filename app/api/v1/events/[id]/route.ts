/**
 * GET /api/v1/events/[id]
 *
 * Fetch a single event by its unique ID.
 *
 * Path Parameters:
 *   - id: The unique string ID of the event
 *
 * Response Schema (200 OK):
 * {
 *   id: string;                  // Unique event identifier
 *   contractId: string;          // Soroban contract address
 *   ledger: number;              // Ledger sequence number
 *   timestamp: number;           // Unix timestamp of the event
 *   txHash: string;              // Transaction hash
 *   topics: any;                 // Array of event topics (stored as JSON array)
 *   data: string;                // Hex-encoded event data
 *   description: string | null;  // Translated human-readable description
 *   status: string;              // Translation status ("translated" | "cryptic")
 *   blueprintName: string | null; // Blueprint/Contract name
 *   eventType: string | null;     // Event type (e.g., "transfer", "mint")
 *   createdAt: string;           // Database creation timestamp
 *   updatedAt: string;           // Database update timestamp
 * }
 *
 * Response (404 Not Found):
 * {
 *   error: string;
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { authenticateAndRateLimit } from "@/lib/api/middleware";
import { toErrorResponse } from "@/lib/api/error-response";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    // Authenticate the request and check rate limits
    const authError = await authenticateAndRateLimit(request);
    if (authError) return authError;

    // Await the route params in Next.js 15+
    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { error: "Event ID parameter is missing" },
        { status: 400 }
      );
    }

    // Query Prisma Event table for an exact match on id field
    const event = await db.event.findUnique({
      where: { id },
    });

    if (!event) {
      return NextResponse.json(
        { error: `Event with ID "${id}" not found` },
        { status: 404 }
      );
    }

    // Return the event as JSON
    return NextResponse.json(event);
  } catch (error) {
    return toErrorResponse(error, { fallbackMessage: "Failed to retrieve event" });
  }
}
