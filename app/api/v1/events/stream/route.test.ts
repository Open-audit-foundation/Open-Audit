/**
 * Tests for GET /api/v1/events/stream
 *
 * We mock next/server (runtime not available outside Next.js), then import and
 * call the GET handler directly. Each test creates a fresh AbortController so
 * the request-level cleanup in the route (abort → unsubscribe + close) fires
 * properly and leaves no dangling broker subscriptions between tests.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import type { TranslatedEvent } from "../../../../../lib/translator/types";

vi.mock("next/server", () => ({
  NextRequest: class {},
  NextResponse: class {},
}));

const { default: broker } = await import(
  "../../../../../lib/streaming/eventBroker"
);
const { GET } = await import("./route");

// Track AbortControllers so afterEach can abort all open streams.
const openACs: AbortController[] = [];

afterEach(() => {
  // Abort all open request signals → triggers route cleanup (unsubscribe + close)
  for (const ac of openACs.splice(0)) ac.abort();
});

function makeRequest(params: Record<string, string> = {}) {
  const url = new URL("http://localhost/api/v1/events/stream");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const ac = new AbortController();
  openACs.push(ac);

  const req = new Request(url.toString(), { signal: ac.signal }) as Request & {
    nextUrl: URL;
  };
  Object.defineProperty(req, "nextUrl", { value: url });
  return { req, ac };
}

function makeEvent(id = "evt-1", contractId = "CABC123", description = "Transfer of 100 XLM"): TranslatedEvent {
  return {
    raw: { id, contractId, topics: [], data: "", ledger: 1, timestamp: 0, txHash: "tx" },
    description,
    status: "translated",
    blueprintName: "SAC",
    eventType: "Transfer",
  };
}

/** Read the first `data:` SSE frame from a ReadableStream, with a 2s timeout. */
function readFirstDataFrame(stream: ReadableStream<Uint8Array>): Promise<TranslatedEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for SSE event")), 2000);
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    function pump(): void {
      reader.read().then(({ done, value }) => {
        if (done) { clearTimeout(timer); reject(new Error("Stream closed")); return; }
        buf += decoder.decode(value, { stream: true });
        const end = buf.indexOf("\n\n");
        if (end !== -1) {
          const frame = buf.slice(0, end);
          if (frame.startsWith("data: ")) {
            clearTimeout(timer);
            reader.cancel();
            resolve(JSON.parse(frame.slice(6)) as TranslatedEvent);
            return;
          }
          buf = buf.slice(end + 2); // skip heartbeat, keep reading
        }
        pump();
      }).catch(reject);
    }
    pump();
  });
}

describe("GET /api/v1/events/stream", () => {
  it("returns 200 with SSE headers", async () => {
    const { req, ac } = makeRequest();
    const res = GET(req as any);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    expect(res.headers.get("Cache-Control")).toBe("no-cache, no-transform");
    expect(res.headers.get("Connection")).toBe("keep-alive");

    ac.abort();
  });

  it("forwards a published event to the stream", async () => {
    const { req } = makeRequest();
    const res = GET(req as any);

    // Give the stream's start() callback a chance to register the subscriber.
    await Promise.resolve();
    broker.publish(makeEvent("e1"));

    const received = await readFirstDataFrame(res.body!);
    expect(received.raw.id).toBe("e1");
    expect(received.eventType).toBe("Transfer");
  });

  it("filters by contract_id — delivers matching, drops non-matching", async () => {
    const { req } = makeRequest({ contract_id: "CABC123" });
    const res = GET(req as any);

    await Promise.resolve();
    broker.publish(makeEvent("skip", "COTHER")); // should be filtered out
    broker.publish(makeEvent("match", "CABC123")); // should arrive

    const received = await readFirstDataFrame(res.body!);
    expect(received.raw.contractId).toBe("CABC123");
    expect(received.raw.id).toBe("match");
  });

  it("filters by search term — delivers matching, drops non-matching", async () => {
    const { req } = makeRequest({ search: "swap" });
    const res = GET(req as any);

    await Promise.resolve();
    broker.publish(makeEvent("skip", "CABC123", "Transfer of 100 XLM")); // no "swap"
    broker.publish(makeEvent("match", "CABC123", "Swap 50 XLM for USDC"));

    const received = await readFirstDataFrame(res.body!);
    expect(received.description).toContain("Swap");
    expect(received.raw.id).toBe("match");
  });
});
