/**
 * Custom Next.js server with an attached WebSocket server.
 * Broadcasts newly translated Soroban events to all connected clients.
 *
 * Run with: npx ts-node --project tsconfig.server.json server.ts
 * (or via the `dev:ws` npm script)
 */
import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { WebSocketServer, WebSocket } from "ws";
import { MOCK_RAW_EVENTS } from "./lib/mock-data";
import { translateEvent } from "./lib/translator/registry";
import { startHorizonStreamingIndexer } from "./lib/stellar/indexer";
import { getNetworkConfig } from "./lib/stellar/client";

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT ?? "3000", 10);

const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' wss://* https://horizon-testnet.stellar.org https://soroban-testnet.stellar.org https://horizon.stellar.org https://mainnet.stellar.validationcloud.io; img-src 'self' data:; font-src 'self' data:;");
    const parsedUrl = parse(req.url ?? "/", true);
    handle(req, res, parsedUrl);
  });

  const wss = new WebSocketServer({ server: httpServer, path: "/ws/events" });

  wss.on("connection", (socket) => {
    console.log("[WS] Client connected");
    socket.on("close", () => console.log("[WS] Client disconnected"));
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
  const indexer = startHorizonStreamingIndexer({
    networkConfig: getNetworkConfig(),
    onEvent: (rawEvent) => {
      console.log(`[Indexer] New event: ${rawEvent.id} from contract ${rawEvent.contractId}`);
      const translated = translateEvent(rawEvent);
      broadcast(translated);
    },
    onError: (err) => {
      console.error("[Indexer] Streaming error:", err);
    },
  });

  httpServer.listen(port, () => {
    console.log(`> Ready on http://localhost:${port}`);
  });
});
