/**
 * ⚠️ DEPRECATION NOTICE ⚠️
 * 
 * This is the LEGACY monolithic server implementation.
 * 
 * KNOWN ISSUES:
 * - Under heavy network load, indexing logic starves HTTP/WebSocket server of CPU cycles
 * - Dropped WebSocket connections during high transaction velocity
 * - No fault isolation: indexer crash kills entire server
 * - Cannot scale independently
 * 
 * RECOMMENDED: Use the decoupled microservices architecture instead:
 * 
 * 1. DOCKER COMPOSE (Recommended for Production):
 *    $ npm run docker:up
 *    $ npm run docker:logs
 * 
 * 2. PM2 PROCESS MANAGER:
 *    $ npm run start:pm2
 *    $ npm run monit:pm2
 * 
 * 3. MANUAL (Development):
 *    Terminal 1: $ redis-server
 *    Terminal 2: $ npm run dev:decoupled
 *    Terminal 3: $ npm run worker:indexer
 * 
 * See: MICROSERVICES_ARCHITECTURE.md for complete documentation
 * See: .env.microservices.example for configuration
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
import { processEventForIpfs } from "./lib/ipfs/offloader";
import { createFileIngestionStateStore, startResilientEventIngestion } from "./lib/stellar/indexer";
import { getNetworkConfig } from "./lib/stellar/client";
import { eventsIngestedTotal, metricsHandler, recordTranslationDuration, startTelemetry } from "./lib/metrics";
import { startRetentionScheduler } from "./lib/retention/scheduler";

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT ?? "3000", 10);
const MAX_WS_CONNECTIONS_PER_IP = parseInt(process.env.MAX_WS_CONNECTIONS_PER_IP ?? "5", 10);
const connectionsByIp = new Map<string, number>();

function parseHistoryArchives(): Record<string, string> {
  const raw = process.env.STELLAR_HISTORY_ARCHIVES;
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed;
  } catch (error) {
    console.warn("[Indexer] Failed to parse STELLAR_HISTORY_ARCHIVES JSON:", error);
    return {};
  }
}

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
  await startTelemetry();
  startRetentionScheduler();
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
    captiveCore: process.env.STELLAR_CORE_BINARY
      ? {
          binaryPath: process.env.STELLAR_CORE_BINARY,
          networkPassphrase: getNetworkConfig().networkPassphrase,
          historyArchives: parseHistoryArchives(),
          startLedger: Number(process.env.INGESTION_START_LEDGER ?? "0"),
          transport:
            process.env.STELLAR_CORE_TRANSPORT === "tcp"
              ? {
                  type: "tcp",
                  host: process.env.STELLAR_CORE_STREAM_HOST ?? "127.0.0.1",
                  port: process.env.STELLAR_CORE_STREAM_PORT
                    ? Number(process.env.STELLAR_CORE_STREAM_PORT)
                    : undefined,
                }
              : { type: "stdio" },
          heartbeatTimeoutMs: Number(process.env.STELLAR_CORE_HEARTBEAT_TIMEOUT_MS ?? "30000"),
          restartDelayMs: Number(process.env.STELLAR_CORE_RESTART_DELAY_MS ?? "5000"),
          maxRestartAttempts: Number(process.env.STELLAR_CORE_MAX_RESTARTS ?? "2"),
        }
      : undefined,
    onEvent: async (rawEvent) => {
      console.log(`[Indexer] New event: ${rawEvent.id} from contract ${rawEvent.contractId}`);

      const processed = await processEventForIpfs(rawEvent);
      rawEvent.data = processed.data;
      rawEvent.topics = processed.topics;

      const translated = recordTranslationDuration(rawEvent.contractId, () => translateEvent(rawEvent));
      eventsIngestedTotal.labels(rawEvent.contractId, translated.status === "translated" ? "success" : "failed").inc();
      broadcast(translated);
    },
    onError: (err) => {
      console.error('[server.ts] Error:', err);
      console.error("[Indexer] Streaming error:", err);
    },
  });

  // Start the retention pruner cron (no-op if RETENTION_ENABLED=false)
  schedulePruner();

  httpServer.listen(port, () => {
    console.log(`> Ready on http://localhost:${port}`);
  });
});
