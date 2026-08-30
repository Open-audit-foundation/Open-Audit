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
 * For production deployments prefer the decoupled architecture:
 *   npm run dev:decoupled   (web server)
 *   npm run worker:indexer    (indexer worker)
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
import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { eventsIngestedTotal, recordTranslationDuration, startTelemetry } from "./lib/metrics";
import { applyContentSecurityPolicy } from "./lib/server/csp";
import { createEventWebSocketServer } from "./lib/server/ws-server";
import { startHorizonStreamingIndexer } from "./lib/stellar/indexer";
import { getNetworkConfig } from "./lib/stellar/client";
import { translateEvent } from "./lib/translator/registry";
import { processEventForIpfs } from "./lib/ipfs/offloader";
import { persistExecutionDag } from "./lib/dag/persistence";

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT ?? "3000", 10);

const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(async () => {
  await startTelemetry();

  // Start the data-retention scheduler (no-op when RETENTION_ENABLED=false).
  startRetentionScheduler();

  const httpServer = createServer((req, res) => {
    applyContentSecurityPolicy(res);
    const parsedUrl = parse(req.url ?? "/", true);
    handle(req, res, parsedUrl);
  });

  const wsServer = createEventWebSocketServer({
    httpServer,
    logPrefix: "[WS]",
  });

  startHorizonStreamingIndexer({
    networkConfig: getNetworkConfig(),
    contractIds: process.env.CONTRACT_IDS ? process.env.CONTRACT_IDS.split(",") : undefined,
    onEvent: async (rawEvent) => {
      console.log(`[Indexer] New event: ${rawEvent.id} from contract ${rawEvent.contractId}`);

      const processed = await processEventForIpfs(rawEvent);
      rawEvent.data = processed.data;
      rawEvent.topics = processed.topics;

      const translated = recordTranslationDuration(rawEvent.contractId, () => translateEvent(rawEvent));
      eventsIngestedTotal
        .labels(translated.status === "translated" ? "success" : "failed")
        .inc();
      wsServer.broadcast(translated);
    },
    onError: (err) => {
      console.error("[server.ts] Error:", err);
      console.error("[Indexer] Streaming error:", err);
    },
    onDag: async (dag) => {
      try {
        await persistExecutionDag(dag);
        if (dag.hasReentrancy) {
          console.warn(
            `[Indexer] Reentrancy detected in tx ${dag.txHash}: ` +
            dag.reentrancyDetails.map((r) => r.description).join("; ")
          );
        }
      } catch (err) {
        console.error("[Indexer] Failed to persist DAG:", err);
      }
    },
  });

  httpServer.listen(port, () => {
    console.log(`> Ready on http://localhost:${port}`);
  });
});
