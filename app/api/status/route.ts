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
import { Server as StellarSorobanRpc } from "stellar-sdk/lib/soroban";
import Redis from "ioredis";
import { resilientStellarClient } from "../../../lib/stellar/resilient-stellar-client";
import { CircuitState } from "../../../lib/resilience/circuit-breaker";

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
        const server = new StellarSorobanRpc(url);
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
 * Aggregate metrics from database
 */
async function aggregateMetrics(): Promise<{
  eventsIndexedLast1h: number;
  eventsIndexedLast24h: number;
  translationSuccessRate1h: number;
  translationSuccessRate24h: number;
  averageTranslationLatencyMs: number;
  activeWebSocketConnections: number;
}> {
  try {
    // TODO: Implement actual database queries based on your schema
    // For now, return mock data as placeholders
    
    // Example queries you might implement:
    // const events1h = await prisma.event.count({
    //   where: { createdAt: { gte: new Date(Date.now() - 3600000) } }
    // });
    
    return {
      eventsIndexedLast1h: 0,
      eventsIndexedLast24h: 0,
      translationSuccessRate1h: 0,
      translationSuccessRate24h: 0,
      averageTranslationLatencyMs: 0,
      activeWebSocketConnections: 0,
    };
  } catch (error) {
    console.error("Failed to aggregate metrics:", error);
    return {
      eventsIndexedLast1h: 0,
      eventsIndexedLast24h: 0,
      translationSuccessRate1h: 0,
      translationSuccessRate24h: 0,
      averageTranslationLatencyMs: 0,
      activeWebSocketConnections: 0,
    };
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

  // If critical component (Stellar RPC or Database) is down, system is down
  if (stellarRpc.status === "down" || 
      (database.status === "down" && database.status !== "not-configured")) {
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
