/**
 * KNOWN LIMITATIONS (single-process server):
 * - Under heavy network load, indexing logic can compete with the HTTP/WebSocket
 *   server for CPU cycles
 * - No fault isolation: an indexer crash takes down the whole process
 * - Cannot scale the indexer and web server independently
 *
 * A previous revision of this repo split the indexer and web server into
 * separate processes (Docker Compose / PM2), but that setup has since been
 * removed. This file is the current server implementation.
 *
 * ---
 *
 * Custom Next.js server with an attached WebSocket server.
 * Broadcasts newly translated Soroban events to all connected clients.
 * Bloated event data (>2KB) is automatically offloaded to IPFS before broadcast.
 *
 * Run with: npx ts-node --project tsconfig.server.json server.ts
 * (or via the `dev:ws` npm script)
 */
import { createServer, IncomingMessage } from "http";
import { parse } from "url";
import next from "next";
import { WebSocketServer, WebSocket } from "ws";
import { MOCK_RAW_EVENTS } from "./lib/mock-data";
import { translateEvent } from "./lib/translator/registry";
import { createFileIngestionStateStore, startResilientEventIngestion } from "./lib/stellar/indexer";
import { getNetworkConfig } from "./lib/stellar/client";
import { eventsIngestedTotal } from "./lib/metrics";

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT ?? "3000", 10);
const MAX_WS_CONNECTIONS_PER_IP = parseInt(process.env.MAX_WS_CONNECTIONS_PER_IP ?? "5", 10);
const connectionsByIp = new Map<string, number>();

function getClientIp(req: IncomingMessage): string {
  const forwardedFor = req.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.length > 0) {
    return forwardedFor.split(",")[0].trim();
  }

  return req.socket.remoteAddress ?? "unknown";
}

const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(async () => {
  const httpServer = createServer((req, res) => {
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' wss://* https://horizon-testnet.stellar.org https://soroban-testnet.stellar.org https://horizon.stellar.org https://mainnet.stellar.validationcloud.io; img-src 'self' data:; font-src 'self' data:;"
    );
    const parsedUrl = parse(req.url ?? "/", true);
    handle(req, res, parsedUrl);
  });

  const wss = new WebSocketServer({ server: httpServer, path: "/ws/events" });

  wss.on("connection", (socket, request) => {
    const clientIp = request ? getClientIp(request) : "unknown";
    const activeConnections = (connectionsByIp.get(clientIp) ?? 0) + 1;

    if (activeConnections > MAX_WS_CONNECTIONS_PER_IP) {
      console.warn(
        `[WS] Rejecting connection from ${clientIp}: too many connections (${activeConnections})`
      );
      socket.close(1008, "Too many connections from this IP");
      return;
    }

    connectionsByIp.set(clientIp, activeConnections);
    console.log(`[WS] Client connected from ${clientIp} (${activeConnections} active)`);

    socket.on("close", () => {
      const remaining = (connectionsByIp.get(clientIp) ?? 0) - 1;
      if (remaining <= 0) {
        connectionsByIp.delete(clientIp);
      } else {
        connectionsByIp.set(clientIp, remaining);
      }
      console.log(`[WS] Client disconnected from ${clientIp} (${Math.max(remaining, 0)} remaining)`);
    });

    // Also clean up on error — socket error may skip the close event
    socket.on("error", () => {
      const remaining = (connectionsByIp.get(clientIp) ?? 0) - 1;
      if (remaining <= 0) {
        connectionsByIp.delete(clientIp);
      } else {
        connectionsByIp.set(clientIp, remaining);
      }
      console.log(`[WS] Client error from ${clientIp} (${Math.max(remaining, 0)} remaining)`);
    });
  });

  /** Broadcast a JSON payload to every connected client. */
  function broadcast(data: unknown): void {
    const message = JSON.stringify(data);
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  // Start the real-time streaming indexer
  const stateStore = createFileIngestionStateStore(
    process.env.INGESTION_STATE_FILE ?? ".open-audit/ingestion-state.json"
  );

  const indexer = startResilientEventIngestion({
    networkConfig: getNetworkConfig(),
    stateStore,
    coldStartLookbackLedgers: Number(process.env.INGESTION_COLD_START_LOOKBACK_LEDGERS ?? "100"),
    onEvent: async (rawEvent) => {
      console.log(`[Indexer] New event: ${rawEvent.id} from contract ${rawEvent.contractId}`);

      const translated = translateEvent(rawEvent);
      eventsIngestedTotal.labels(rawEvent.contractId, translated.status === "translated" ? "success" : "failed").inc();
      broadcast(translated);
    },
    onError: (err) => {
      console.error('[server.ts] Error:', err);
      console.error("[Indexer] Streaming error:", err);
    },
  });

  httpServer.listen(port, () => {
    console.log(`> Ready on http://localhost:${port}`);
  });
});
