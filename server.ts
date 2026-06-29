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
 * Run with: npx ts-node --project tsconfig.server.json server.ts --legacy
 * (or via the `dev:ws:legacy` npm script)
 */

// Visible runtime deprecation warning for developers running the legacy server.
// This should make it obvious when someone accidentally starts the deprecated
// monolithic server. The process continues to run for compatibility, but the
// warning recommends the decoupled microservices path.
console.warn("\n\u001b[33mDEPRECATION: \`server.ts\` is a legacy monolithic server with a known CPU-starvation flaw.\nRecommended: use the microservices/decoupled path (npm run dev:decoupled).\nTo run the legacy server anyway, use the explicit script: npm run dev:legacy\u001b[0m\n");
import { createServer, IncomingMessage } from "http";
import { parse } from "url";
import next from "next";
import { WebSocketServer, WebSocket } from "ws";
import { MOCK_RAW_EVENTS } from "./lib/mock-data";
import { translateEvent } from "./lib/translator/registry";
import type { RawEvent } from "./lib/translator/types";
import { processEventForIpfs } from "./lib/ipfs/offloader";
import { createFileIngestionStateStore } from "./lib/stellar/ingestion-state";
import { startResilientEventIngestion } from "./lib/stellar/indexer";
import { getNetworkConfig } from "./lib/stellar/client";
import { captureExceptionSync, eventsIngestedTotal, metricsHandler, recordTranslationDuration, startTelemetry } from "./lib/telemetry";
import { startRetentionScheduler } from "./lib/retention/scheduler";
import { schedulePruner } from "./lib/retention/pruner";

const legacyExplicitlyEnabled =
  process.argv.includes("--legacy") || process.env.OPEN_AUDIT_LEGACY_SERVER === "1";

if (!legacyExplicitlyEnabled) {
  console.error(
    [
      "[legacy-server] Refusing to start server.ts without an explicit legacy opt-in.",
      "Use `npm run dev:ws` for the recommended decoupled WebSocket server.",
      "If you are migrating old local scripts, use `npm run dev:ws:legacy` or pass `--legacy`.",
    ].join("\n")
  );
  process.exit(1);
}

console.warn(
  [
    "[legacy-server] Starting deprecated monolithic server.ts.",
    "The decoupled microservices path is recommended: npm run dev:ws + npm run worker:indexer.",
  ].join("\n")
);

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

  let broadcast: (data: unknown) => void = () => {};

  const httpServer = createServer((req, res) => {
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' wss://* https://horizon-testnet.stellar.org https://soroban-testnet.stellar.org https://horizon.stellar.org https://mainnet.stellar.validationcloud.io; img-src 'self' data:; font-src 'self' data:;"
    );
    const parsedUrl = parse(req.url ?? "/", true);

    if (process.env.E2E_TEST_MODE === "true" && parsedUrl.pathname === "/e2e/inject-event") {
      if (req.method !== "POST") {
        res.statusCode = 405;
        res.end("Method Not Allowed");
        return;
      }

      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        void (async () => {
          try {
            const rawEvent = JSON.parse(Buffer.concat(chunks).toString("utf8")) as RawEvent;
            const processed = await processEventForIpfs(rawEvent);
            rawEvent.data = processed.data;
            rawEvent.topics = processed.topics;
            const translated = recordTranslationDuration(rawEvent.contractId, () =>
              translateEvent(rawEvent)
            );
            broadcast(translated);
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(translated));
          } catch (error) {
            res.statusCode = 400;
            res.end(error instanceof Error ? error.message : String(error));
          }
        })();
      });
      return;
    }

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
      const remaining = (connectionsByIp.get(clientIp) ?? 1) - 1;
      if (remaining <= 0) {
        connectionsByIp.delete(clientIp);
      } else {
        connectionsByIp.set(clientIp, remaining);
      }
      console.log(`[WS] Client disconnected from ${clientIp} (${Math.max(remaining, 0)} remaining)`);
    });
  });

  /** Broadcast a JSON payload to every connected client. */
  broadcast = (data: unknown): void => {
    const message = JSON.stringify(data);
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  };

  if (process.env.E2E_TEST_MODE !== "true") {
    // Start the real-time streaming indexer
    const stateStore = createFileIngestionStateStore(
      process.env.INGESTION_STATE_FILE ?? ".open-audit/ingestion-state.json"
    );

    startResilientEventIngestion({
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
      captureExceptionSync(err, { context: { operation: "resilientStreamingIndexer" } });
      console.error("[Indexer] Streaming error:", err);
    },
    });
  }

  // Start the retention pruner cron (no-op if RETENTION_ENABLED=false)
  schedulePruner();

  httpServer.listen(port, () => {
    console.log(`> Ready on http://localhost:${port}`);
  });
});
