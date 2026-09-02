import { createServer, type Server } from "http";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { activeWebSocketConnections } from "../../metrics";
import { createEventWebSocketServer, type EventWebSocketServer } from "../ws-server";

async function gaugeValue(): Promise<number> {
  const sample = await activeWebSocketConnections.get();
  return sample.values?.[0]?.value ?? 0;
}

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.on("open", () => resolve());
    ws.on("error", reject);
  });
}

function waitForClose(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    ws.on("close", () => resolve());
  });
}

/**
 * The client-side close event can resolve before the server has processed
 * the close handshake, so poll for the expected gauge value.
 */
async function waitForGauge(expected: number, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if ((await gaugeValue()) === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Gauge did not reach ${expected} within ${timeoutMs}ms (last: ${await gaugeValue()})`);
}

describe("activeWebSocketConnections gauge", () => {
  let httpServer: Server | null = null;
  let wsServer: EventWebSocketServer | null = null;

  afterEach(async () => {
    if (wsServer) {
      await wsServer.close().catch(() => {});
      wsServer = null;
    }
    await new Promise<void>((resolve) => {
      if (!httpServer) {
        resolve();
        return;
      }
      httpServer.close(() => resolve());
    });
    httpServer = null;
  });

  it("increments on connect and decrements on close", async () => {
    const baseline = await gaugeValue();

    httpServer = createServer((_req, res) => {
      res.writeHead(200);
      res.end("ok");
    });

    wsServer = createEventWebSocketServer({
      httpServer,
      path: "/ws/events",
      logPrefix: "[test-ws-gauge]",
    });

    await new Promise<void>((resolve, reject) => {
      httpServer!.listen(0, () => {
        const address = httpServer!.address();
        if (!address || typeof address === "string") {
          reject(new Error("Failed to bind test server"));
          return;
        }

        (async () => {
          const ws = new WebSocket(`ws://127.0.0.1:${address.port}/ws/events`);
          const closed = waitForClose(ws);
          await waitForOpen(ws);
          expect(await gaugeValue()).toBe(baseline + 1);
          ws.close();
          await closed;
          await waitForGauge(baseline);
          resolve();
        })().catch(reject);
      });
    });
  });

  it("does not decrement twice when a socket errors and then closes", async () => {
    const baseline = await gaugeValue();

    httpServer = createServer((_req, res) => {
      res.writeHead(200);
      res.end("ok");
    });

    wsServer = createEventWebSocketServer({
      httpServer,
      path: "/ws/events",
      maxConnectionsPerIp: 1,
      logPrefix: "[test-ws-gauge]",
    });

    await new Promise<void>((resolve, reject) => {
      httpServer!.listen(0, () => {
        const address = httpServer!.address();
        if (!address || typeof address === "string") {
          reject(new Error("Failed to bind test server"));
          return;
        }

        (async () => {
          const first = new WebSocket(`ws://127.0.0.1:${address.port}/ws/events`);
          const firstClosed = waitForClose(first);
          await waitForOpen(first);
          expect(await gaugeValue()).toBe(baseline + 1);

          // Second connection from the same IP is rejected (1008). Rejected
          // sockets also emit close; the gauge must stay at exactly +1.
          const second = new WebSocket(`ws://127.0.0.1:${address.port}/ws/events`);
          await waitForClose(second);
          expect(await gaugeValue()).toBe(baseline + 1);

          first.close();
          await firstClosed;
          await waitForGauge(baseline);
          resolve();
        })().catch(reject);
      });
    });
  });
});
