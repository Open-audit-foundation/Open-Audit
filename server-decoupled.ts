/**
 * Decoupled web-only server for the microservices architecture.
 *
 * This process serves Next.js HTTP routes and WebSocket clients but does NOT
 * run indexing logic. Events arrive via Redis pub/sub from the standalone
 * indexer worker (src/worker/indexer.ts).
 *
 * Run with: npm run dev:decoupled
 */
import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { createRedisSubscriber } from "./lib/redis/subscriber";
import { eventsIngestedTotal, recordTranslationDuration, startTelemetry } from "./lib/metrics";
import { applyContentSecurityPolicy } from "./lib/server/csp";
import { createEventWebSocketServer } from "./lib/server/ws-server";

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT ?? "3000", 10);

const app = next({ dev });
const handle = app.getRequestHandler();

let redisSubscriber: ReturnType<typeof createRedisSubscriber> | null = null;
let wsServer: ReturnType<typeof createEventWebSocketServer> | null = null;

async function shutdown(signal: string): Promise<void> {
  console.log(`[WebServer] Received ${signal}, shutting down...`);

  try {
    if (redisSubscriber) {
      await redisSubscriber.disconnect();
    }
    if (wsServer) {
      await wsServer.close();
    }
  } finally {
    process.exit(0);
  }
}

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("uncaughtException", (error) => {
  console.error("[WebServer] Uncaught exception:", error);
});

process.on("unhandledRejection", (reason) => {
  console.error("[WebServer] Unhandled rejection:", reason);
});

app.prepare().then(async () => {
  await startTelemetry();

  const httpServer = createServer((req, res) => {
    applyContentSecurityPolicy(res);
    const parsedUrl = parse(req.url ?? "/", true);
    handle(req, res, parsedUrl);
  });

  wsServer = createEventWebSocketServer({
    httpServer,
    logPrefix: "[WS]",
  });

  redisSubscriber = createRedisSubscriber({
    logPrefix: "[WebServer]",
    onEvent: (translated) => {
      recordTranslationDuration(translated.raw.contractId, () => translated);
      eventsIngestedTotal
        .labels(translated.status === "translated" ? "success" : "failed")
        .inc();
      wsServer?.broadcast(translated);
    },
    onError: (error) => {
      // Fault isolation: Redis errors must not crash the web server process.
      console.error("[WebServer] Redis subscriber error (web server continues):", error.message);
    },
  });

  await redisSubscriber.connect();

  httpServer.listen(port, () => {
    console.log(`> Decoupled web server ready on http://localhost:${port}`);
    console.log(`> WebSocket endpoint: ws://localhost:${port}/ws/events`);
    console.log("> Waiting for events from indexer worker via Redis pub/sub...");
  });
});
