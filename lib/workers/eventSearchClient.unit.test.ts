/**
 * Direct unit tests for the EventSearchClient class.
 *
 * These tests verify the client's API surface and lifecycle management.
 * Since Worker + import.meta.url cannot be reliably mocked in vitest,
 * we test by mocking the module and verifying the class contract.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Build a minimal mock of the Worker that we can inspect ──────────────

const mockTerminate = vi.fn();
const mockPostMessage = vi.fn();
let mockOnMessage: ((e: { data: Record<string, unknown> }) => void) | null = null;

function installMockWorker() {
  const MockWorker = vi.fn().mockImplementation(() => ({
    postMessage: mockPostMessage,
    terminate: mockTerminate,
    set onmessage(fn: (e: { data: Record<string, unknown> }) => void) {
      mockOnMessage = fn;
    },
    onerror: vi.fn(),
  }));

  // Stub the global Worker and import.meta.url before the module loads.
  // NOTE: import.meta.url stubbing doesn't work in all vitest versions,
  // so we also need to handle the URL constructor gracefully.
  vi.stubGlobal("Worker", MockWorker);
}

function respond(requestId: string, payload: Record<string, unknown>) {
  if (mockOnMessage) {
    mockOnMessage({ data: { requestId, ...payload } });
  }
}

// ── Test suite ─────────────────────────────────────────────────────────

describe("EventSearchClient API contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOnMessage = null;
  });

  it("exports the expected class methods", async () => {
    // Dynamically import to check the shape without instantiating.
    const mod = await import("./eventSearchClient");
    expect(typeof mod.EventSearchClient).toBe("function");

    const proto = mod.EventSearchClient.prototype;
    expect(typeof proto.buildIndex).toBe("function");
    expect(typeof proto.addEvents).toBe("function");
    expect(typeof proto.removeEvents).toBe("function");
    expect(typeof proto.search).toBe("function");
    expect(typeof proto.destroy).toBe("function");
  });

  it("buildIndex sends BUILD_INDEX with events and hash", async () => {
    installMockWorker();
    const { EventSearchClient } = await import("./eventSearchClient");
    const client = new EventSearchClient();

    const events = [{ raw: { id: "e1" }, description: "test" }] as any[];
    const p = client.buildIndex(events, "hash1");

    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "BUILD_INDEX",
        events,
      })
    );

    const msg = mockPostMessage.mock.calls[0][0];
    respond(msg.requestId, { ok: true });
    await p;

    client.destroy();
  });

  it("addEvents sends ADD_EVENTS with events", async () => {
    installMockWorker();
    const { EventSearchClient } = await import("./eventSearchClient");
    const client = new EventSearchClient();

    const events = [{ raw: { id: "e2" } }] as any[];
    const p = client.addEvents(events);

    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ADD_EVENTS", events })
    );

    respond(mockPostMessage.mock.calls[0][0].requestId, { totalCount: 1 });
    expect(await p).toBe(1);

    client.destroy();
  });

  it("addEvents returns 0 for empty array without posting", async () => {
    installMockWorker();
    const { EventSearchClient } = await import("./eventSearchClient");
    const client = new EventSearchClient();

    expect(await client.addEvents([])).toBe(0);
    expect(mockPostMessage).not.toHaveBeenCalled();

    client.destroy();
  });

  it("removeEvents sends REMOVE_EVENTS with eventIds", async () => {
    installMockWorker();
    const { EventSearchClient } = await import("./eventSearchClient");
    const client = new EventSearchClient();

    const p = client.removeEvents(["e1", "e2"]);

    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "REMOVE_EVENTS", eventIds: ["e1", "e2"] })
    );

    respond(mockPostMessage.mock.calls[0][0].requestId, { totalCount: 0 });
    expect(await p).toBe(0);

    client.destroy();
  });

  it("removeEvents returns 0 for empty array", async () => {
    installMockWorker();
    const { EventSearchClient } = await import("./eventSearchClient");
    const client = new EventSearchClient();

    expect(await client.removeEvents([])).toBe(0);

    client.destroy();
  });

  it("search sends SEARCH and returns hits", async () => {
    installMockWorker();
    const { EventSearchClient } = await import("./eventSearchClient");
    const client = new EventSearchClient();

    const p = client.search("transfer", { limit: 10 });

    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "SEARCH", query: "transfer", limit: 10 })
    );

    respond(mockPostMessage.mock.calls[0][0].requestId, {
      hits: [{ id: "e1", score: 10 }],
    });

    expect(await p).toEqual([{ id: "e1", score: 10 }]);

    client.destroy();
  });

  it("search rejects on SEARCH_ERROR response", async () => {
    installMockWorker();
    const { EventSearchClient } = await import("./eventSearchClient");
    const client = new EventSearchClient();

    const p = client.search("bad");
    respond(mockPostMessage.mock.calls[0][0].requestId, {
      type: "SEARCH_ERROR",
      error: "Invalid query",
    });

    // The client rejects the promise with the SEARCH_ERROR message object.
    await expect(p).rejects.toBeDefined();

    client.destroy();
  });

  it("destroy terminates the worker", async () => {
    installMockWorker();
    const { EventSearchClient } = await import("./eventSearchClient");
    const client = new EventSearchClient();

    // Trigger worker creation.
    client.search("test");
    client.destroy();

    expect(mockTerminate).toHaveBeenCalledTimes(1);
  });

  it("buildIndex skips rebuild for same hash", async () => {
    installMockWorker();
    const { EventSearchClient } = await import("./eventSearchClient");
    const client = new EventSearchClient();

    const events = [{ raw: { id: "e1" } }] as any[];

    const p1 = client.buildIndex(events, "h1");
    respond(mockPostMessage.mock.calls[0][0].requestId, { ok: true });
    await p1;

    mockPostMessage.mockClear();
    await client.buildIndex(events, "h1");
    expect(mockPostMessage).not.toHaveBeenCalled();

    client.destroy();
  });

  it("buildIndex rebuilds when hash changes", async () => {
    installMockWorker();
    const { EventSearchClient } = await import("./eventSearchClient");
    const client = new EventSearchClient();

    const p1 = client.buildIndex([{ raw: { id: "e1" } }] as any[], "h1");
    respond(mockPostMessage.mock.calls[0][0].requestId, { ok: true });
    await p1;

    mockPostMessage.mockClear();
    const p2 = client.buildIndex([{ raw: { id: "e2" } }] as any[], "h2");
    expect(mockPostMessage).toHaveBeenCalledTimes(1);
    respond(mockPostMessage.mock.calls[0][0].requestId, { ok: true });
    await p2;

    client.destroy();
  });
});
