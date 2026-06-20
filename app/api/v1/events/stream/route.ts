/**
 * GET /api/v1/events/stream
 *
 * Server-Sent Events endpoint. Streams translated Soroban contract events
 * in real time using the in-process EventBroker.
 *
 * Query parameters
 * ─────────────────
 * contract_id  (optional)  – only stream events from this contract address
 * search       (optional)  – only stream events whose description or
 *                            eventType contains this string (case-insensitive)
 *
 * Connection lifecycle
 * ─────────────────────
 * • A `: ping` heartbeat comment is sent every 25 s to keep the connection
 *   alive and allow clients to detect stale sockets.
 * • When the client disconnects the request AbortSignal fires, which
 *   unsubscribes from the broker and clears the heartbeat timer.
 */
import type { NextRequest } from "next/server";
import broker from "../../../../../lib/streaming/eventBroker";

export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 25_000;

export function GET(request: NextRequest): Response {
  const { searchParams } = request.nextUrl;
  const filter = {
    contractId: searchParams.get("contract_id") ?? undefined,
    search: searchParams.get("search") ?? undefined,
  };

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Subscribe to broker with client's filter.
      const unsubscribe = broker.subscribe(filter, (event) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
          );
        } catch { /* stream already closed */ }
      });

      // Heartbeat — keeps the HTTP connection alive and signals liveness.
      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(": ping\n\n"));
      }, HEARTBEAT_MS);

      // Cleanup when the client disconnects.
      request.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        unsubscribe();
        try { controller.close(); } catch { /* already closed */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // Disable Nginx buffering if behind a proxy.
    },
  });
}
