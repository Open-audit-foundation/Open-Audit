/**
 * Health Check API
 * GET /api/health
 */

import { NextRequest, NextResponse } from "next/server";

interface HealthStatus {
  status: string;
  service: string;
  timestamp: string;
  uptime: number;
  environment: string;
  version: string;
  redis?: { connected: boolean; error?: string };
  database?: Record<string, unknown>;
  indexer?: Record<string, unknown>;
}

export async function GET(_request: NextRequest) {
  try {
    const healthStatus: HealthStatus = {
      status: "healthy",
      service: "open-audit-web-server",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || "development",
      version: process.env.npm_package_version || "unknown",
    };

    if (process.env.REDIS_URL) {
      try {
        const Redis = require("ioredis");
        const redis = new Redis(process.env.REDIS_URL, {
          connectTimeout: 2000,
          maxRetriesPerRequest: 1,
        });

        await redis.ping();
        await redis.quit();

        healthStatus.redis = { connected: true };
      } catch (redisError) {
        const message = redisError instanceof Error ? redisError.message : String(redisError);
        console.warn("[health] Redis check failed:", message);
        healthStatus.redis = {
          connected: false,
          error: message,
        };
      }
    }

    try {
      if (process.env.DATABASE_URL) {
        const { getIndexerHealthMetrics } = require("@/lib/stellar/indexer-persistent");

        const metrics = await getIndexerHealthMetrics();

        healthStatus.database = {
          connected: true,
          totalEvents: metrics.totalEvents,
          verifiedEvents: metrics.verifiedEvents,
          pendingVerification: metrics.pendingVerification,
          verificationRate: metrics.verificationRate,
        };

        healthStatus.indexer = {
          lastLedger: metrics.lastLedger,
        };

        healthStatus.status = metrics.healthy ? "healthy" : "degraded";
      }
    } catch (dbError) {
      const message = dbError instanceof Error ? dbError.message : String(dbError);
      console.warn("[health] Database check failed:", message);
      healthStatus.database = {
        connected: false,
        error: message,
      };
      if (process.env.DATABASE_URL) {
        healthStatus.status = "degraded";
      }
    }

    return NextResponse.json(healthStatus, { status: 200 });
  } catch (error) {
    console.error("[health] Health check failed:", error);

    return NextResponse.json(
      {
        status: "unhealthy",
        service: "open-audit-web-server",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
}
