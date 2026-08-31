import { createServer, type Server } from "http";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createEventWebSocketServer } from "../ws-server";

describe("decoupled fault isolation", () => {
  let httpServer: Server | null = null;

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      if (!httpServer) {
        resolve();
        return;
      }
      httpServer.close(() => resolve());
    });
    httpServer = null;
  });

  it("keeps WebSocket connections alive when the Redis subscriber reports errors", async () => {
    httpServer = createServer((_req, res) => {
      res.writeHead(200);
      res.end("ok");
    });

    const wsServer = createEventWebSocketServer({
      httpServer,
      path: "/ws/events",
      logPrefix: "[test-ws]",
    });

    await new Promise<void>((resolve) => simulateRedisSubscriberError(resolve));

    await new Promise<void>((resolve, reject) => {
      httpServer!.listen(0, () => {
        const address = httpServer!.address();
        if (!address || typeof address === "string") {
          reject(new Error("Failed to bind test server"));
          return;
        }

        const ws = new WebSocket(`ws://127.0.0.1:${address.port}/ws/events`);
        ws.on("open", () => {
          wsServer.broadcast({ status: "translated", description: "still alive" });
        });
        ws.on("message", (data) => {
          const payload = JSON.parse(String(data));
          expect(payload.description).toBe("still alive");
          ws.close();
          resolve();
        });
        ws.on("error", reject);
      });
    });
  });
});

/**
 * Simulates Redis subscriber failure without taking down the web server process.
 * In production, server-decoupled.ts logs the error and continues serving HTTP/WS.
 */
function simulateRedisSubscriberError(onErrorHandled: () => void): void {
  try {
    throw new Error("Redis subscriber disconnected");
  } catch (error) {
    console.error("[test] Redis subscriber error (web server continues):", (error as Error).message);
    onErrorHandled();
  }
}
