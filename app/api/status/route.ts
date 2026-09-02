/**
 * System Status & Health Check API Endpoint
 *
 * Performs comprehensive health checks across all system components:
 * - Stellar RPC (with circuit breaker state)
 * - Database (Prisma connection)
 * - Redis cache (if configured)
 * - Indexer worker (via heartbeat)
 * - Metrics aggregation
 *
 * Returns detailed status in under 500ms with graceful degradation.
 * Runs checks in parallel where possible for optimal performance.
 */

import { NextResponse } from "next/server";
import { SorobanRpc } from "stellar-sdk";
import Redis from "ioredis";
import { resilientStellarClient } from "../../../lib/stellar/resilient-stellar-client";
import { CircuitState } from "../../../lib/resilience/circuit-breaker";
import { activeWebSocketConnections } from "../../../lib/metrics";

// ============================================================================
// Type Definitions
// ============================================================================

type ComponentStatus = "healthy" | "degraded" | "down" | "not-configured";

type OverallStatus = "healthy" | "degraded" | "down";

interface ComponentHealth {
  status: ComponentStatus;
  latencyMs?: number;
  error?: string;
  details?: Record<string, any>;
}

interface ComponentHealthResponse {
  status: ComponentStatus;
  latencyMs?: number;
  lastChecked: string;
  circuitBreakerState?: string;
  lastHeartbeat?: string;
  error?: string;
}

interface StatusResponse {
  status: OverallStatus;
  timestamp: string;
  components: {
    stellarRpc: ComponentHealthResponse;
    database: ComponentHealthResponse;
    redis: ComponentHealthResponse;
    worker: ComponentHealthResponse;
  };
  metrics: {
    eventsIndexedLast1h: number;
    eventsIndexedLast24h: number;
    translationSuccessRate1h: number;
    translationSuccessRate24h: number;
    averageTranslationLatencyMs: number;
    activeWebSocketConnections: number;
  };
}

// ============================================================================
// Health Check Functions
// ============================================================================

/**
 * Check Stellar RPC health by pinging getLatestLedger
 * Also reads circuit breaker state
 */
async function checkStellarRpc(): Promise<ComponentHealthResponse> {
  const startTime = Date.now();
  const lastChecked = new Date().toISOString();

  try {
    // Get circuit breaker metrics
    const metrics = resilientStellarClient.metrics();
    const circuitBreakerMetrics = metrics.circuitBreakers[0]?.metrics;
    
    let circuitBreakerState = "closed";
    if (circuitBreakerMetrics) {
      if (circuitBreakerMetrics.state === CircuitState.OPEN) {
        circuitBreakerState = "open";
      } else if (circuitBreakerMetrics.state === CircuitState.HALF_OPEN) {
        circuitBreakerState = "half-open";
      }
    }

    // Attempt to fetch latest ledger
    await Promise.race([
      resilientStellarClient.execute(async (url) => {
        const server = new SorobanRpc.Server(url);
        return await server.getLatestLedger();
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Timeout")), 3000)
      ),
    ]);

    const latencyMs = Date.now() - startTime;

    // Determine status based on circuit breaker state
    let status: ComponentStatus = "healthy";
    if (circuitBreakerState === "open") {
      status = "degraded";
    } else if (circuitBreakerState === "half-open") {
      status = "degraded";
    }

    return {
      status,
      latencyMs,
      lastChecked,
      circuitBreakerState,
    };
  } catch (error: any) {
    const latencyMs = Date.now() - startTime;

    return {
      status: "down",
      latencyMs,
      lastChecked,
      circuitBreakerState: "unknown",
      error: error.message || "Unknown error",
    };
  }
}

/**
 * Check database health with a lightweight test query
 */
async function checkDatabase(): Promise<ComponentHealthResponse> {
  const startTime = Date.now();
  const lastChecked = new Date().toISOString();

  try {
    // Import Prisma dynamically to avoid initialization errors
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();

    try {
      // Execute a lightweight query (SELECT 1 equivalent)
      await Promise.race([
        prisma.$queryRaw`SELECT 1 as health`,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Timeout")), 2000)
        ),
      ]);

      const latencyMs = Date.now() - startTime;

      return {
        status: "healthy",
        latencyMs,
        lastChecked,
      };
    } finally {
      await prisma.$disconnect();
    }
  } catch (error: any) {
    const latencyMs = Date.now() - startTime;

    // Check if database is simply not configured
    if (error.message?.includes("DATABASE_URL")) {
      return {
        status: "not-configured",
        lastChecked,
        error: "Database not configured",
      };
    }

    return {
      status: "down",
      latencyMs,
      lastChecked,
      error: error.message || "Unknown error",
    };
  }
}

/**
 * Check Redis health (if configured)
 */
async function checkRedis(): Promise<ComponentHealthResponse> {
  const redisUrl = process.env.REDIS_URL;
  const lastChecked = new Date().toISOString();

  if (!redisUrl) {
    return {
      status: "not-configured",
      lastChecked,
    };
  }

  const startTime = Date.now();
  let client: Redis | null = null;

  try {
    client = new Redis(redisUrl, {
      connectTimeout: 2000,
      maxRetriesPerRequest: 1,
    });

    // Ping the server
    await Promise.race([
      client.ping(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Timeout")), 2000)
      ),
    ]);

    const latencyMs = Date.now() - startTime;

    return {
      status: "healthy",
      latencyMs,
      lastChecked,
    };
  } catch (error: any) {
    const latencyMs = Date.now() - startTime;

    return {
      status: "down",
      latencyMs,
      lastChecked,
      error: error.message || "Unknown error",
    };
  } finally {
    if (client) {
      client.disconnect();
    }
  }
}

/**
 * Check indexer worker health via heartbeat
 */
async function checkWorker(): Promise<ComponentHealthResponse> {
  const redisUrl = process.env.REDIS_URL;
  const lastChecked = new Date().toISOString();

  if (!redisUrl) {
    return {
      status: "not-configured",
      lastChecked,
    };
  }

  const startTime = Date.now();
  let client: Redis | null = null;

  try {
    client = new Redis(redisUrl, {
      connectTimeout: 2000,
      maxRetriesPerRequest: 1,
    });

    // Read worker heartbeat
    const lastSeen = await Promise.race([
      client.hget("open-audit:worker:heartbeat", "lastSeen"),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Timeout")), 2000)
      ),
    ]) as string | null;

    const latencyMs = Date.now() - startTime;

    if (!lastSeen) {
      return {
        status: "down",
        latencyMs,
        lastChecked,
        error: "No heartbeat found",
      };
    }

    // Check if heartbeat is recent (within 90 seconds)
    const lastSeenTime = new Date(lastSeen).getTime();
    const nowTime = Date.now();
    const ageSeconds = Math.floor((nowTime - lastSeenTime) / 1000);

    if (ageSeconds > 90) {
      return {
        status: "down",
        latencyMs,
        lastChecked,
        lastHeartbeat: lastSeen,
        error: `Worker heartbeat is stale (${ageSeconds}s old)`,
      };
    }

    return {
      status: "healthy",
      latencyMs,
      lastChecked,
      lastHeartbeat: lastSeen,
    };
  } catch (error: any) {
    const latencyMs = Date.now() - startTime;

    return {
      status: "down",
      latencyMs,
      lastChecked,
      error: error.message || "Unknown error",
    };
  } finally {
    if (client) {
      client.disconnect();
    }
  }
}

/**
 * Read the live WebSocket gauge maintained by lib/server/ws-server.
 * The gauge is process-local, so this reflects real connections when the
 * route runs in the same process as the WebSocket server (legacy monolith
 * and decoupled web server both attach it), and degrades to 0 otherwise.
 */
async function getActiveWebSocketConnections(): Promise<number> {
  try {
    const sample = await activeWebSocketConnections.get();
    const value = sample.values?.[0]?.value;
    return typeof value === "number" ? value : 0;
  } catch {
    return 0;
  }
}

interface MetricCounts {
  events_1h: bigint | number | string;
  events_24h: bigint | number | string;
  translated_1h: bigint | number | string;
  translated_24h: bigint | number | string;
}

function toNumber(value: bigint | number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Aggregate metrics from the database.
 *
 * Event counts and translation success rates come from real queries against
 * the Event table (Postgres COUNT ... FILTER, evaluated server-side in a
 * single round-trip). Translation latency is not recorded per event in the
 * current schema, so it stays 0 until a duration column exists. The
 * WebSocket connection count is read from the Prometheus gauge kept by
 * lib/server/ws-server rather than hardcoded.
 */
async function aggregateMetrics(): Promise<{
  eventsIndexedLast1h: number;
  eventsIndexedLast24h: number;
  translationSuccessRate1h: number;
  translationSuccessRate24h: number;
  averageTranslationLatencyMs: number;
  activeWebSocketConnections: number;
}> {
  const activeWs = await getActiveWebSocketConnections();

  const fallback = {
    eventsIndexedLast1h: 0,
    eventsIndexedLast24h: 0,
    translationSuccessRate1h: 0,
    translationSuccessRate24h: 0,
    averageTranslationLatencyMs: 0,
    activeWebSocketConnections: activeWs,
  };

  try {
    // Import Prisma dynamically to avoid initialization errors
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();

    try {
      const rows = await Promise.race([
        prisma.$queryRaw<MetricCounts[]>`
          SELECT
            COUNT(*) FILTER (WHERE "createdAt" >= NOW() - INTERVAL '1 hour')   AS events_1h,
            COUNT(*) FILTER (WHERE "createdAt" >= NOW() - INTERVAL '24 hours') AS events_24h,
            COUNT(*) FILTER (WHERE "createdAt" >= NOW() - INTERVAL '1 hour'   AND status = 'translated') AS translated_1h,
            COUNT(*) FILTER (WHERE "createdAt" >= NOW() - INTERVAL '24 hours' AND status = 'translated') AS translated_24h
          FROM "Event"
        `,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Timeout")), 2000)
        ),
      ]);

      const row = rows[0];
      if (!row) return fallback;

      const events1h = toNumber(row.events_1h);
      const events24h = toNumber(row.events_24h);
      const translated1h = toNumber(row.translated_1h);
      const translated24h = toNumber(row.translated_24h);

      return {
        eventsIndexedLast1h: events1h,
        eventsIndexedLast24h: events24h,
        // UI renders these as percentages (e.g. "98.5%").
        translationSuccessRate1h:
          events1h > 0 ? Math.round((translated1h / events1h) * 1000) / 10 : 0,
        translationSuccessRate24h:
          events24h > 0 ? Math.round((translated24h / events24h) * 1000) / 10 : 0,
        // The schema records no per-event translation duration yet.
        averageTranslationLatencyMs: 0,
        activeWebSocketConnections: activeWs,
      };
    } finally {
      await prisma.$disconnect();
    }
  } catch (error) {
    console.error("Failed to aggregate metrics:", error);
    return fallback;
  }
}

/**
 * Determine overall system status based on component statuses
 */
function determineOverallStatus(components: {
  stellarRpc: ComponentHealthResponse;
  database: ComponentHealthResponse;
  redis: ComponentHealthResponse;
  worker: ComponentHealthResponse;
}): OverallStatus {
  const { stellarRpc, database, redis, worker } = components;

  if (stellarRpc.status === "down" || database.status === "down") {
    return "down";
  }

  // If any component is degraded or down (excluding not-configured), system is degraded
  const hasIssues =
    stellarRpc.status === "degraded" ||
    (database.status !== "healthy" && database.status !== "not-configured") ||
    (redis.status !== "healthy" && redis.status !== "not-configured") ||
    (worker.status !== "healthy" && worker.status !== "not-configured");

  if (hasIssues) {
    return "degraded";
  }

  return "healthy";
}

// ============================================================================
// API Route Handler
// ============================================================================

export async function GET(request: Request) {
  const startTime = Date.now();

  try {
    // Run all health checks in parallel for optimal performance
    const [stellarRpc, database, redis, worker] = await Promise.all([
      checkStellarRpc(),
      checkDatabase(),
      checkRedis(),
      checkWorker(),
    ]);

    const components = {
      stellarRpc,
      database,
      redis,
      worker,
    };

    // Determine overall status
    const overallStatus = determineOverallStatus(components);

    // Aggregate metrics
    const metrics = await aggregateMetrics();

    const response: StatusResponse = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      components,
      metrics,
    };

    // Set appropriate HTTP status code
    const httpStatus = 
      overallStatus === "healthy" ? 200 : 
      overallStatus === "degraded" ? 200 : 
      503;

    return NextResponse.json(response, {
      status: httpStatus,
      headers: {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
      },
    });
  } catch (error: any) {
    console.error("Status check failed:", error);

    return NextResponse.json(
      {
        status: "down",
        timestamp: new Date().toISOString(),
        components: {
          stellarRpc: { status: "down", lastChecked: new Date().toISOString(), error: "Status check failed" },
          database: { status: "down", lastChecked: new Date().toISOString(), error: "Status check failed" },
          redis: { status: "down", lastChecked: new Date().toISOString(), error: "Status check failed" },
          worker: { status: "down", lastChecked: new Date().toISOString(), error: "Status check failed" },
        },
        metrics: {
          eventsIndexedLast1h: 0,
          eventsIndexedLast24h: 0,
          translationSuccessRate1h: 0,
          translationSuccessRate24h: 0,
          averageTranslationLatencyMs: 0,
          activeWebSocketConnections: 0,
        },
      },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-cache, no-store, must-revalidate",
        },
      }
    );
  }
}
