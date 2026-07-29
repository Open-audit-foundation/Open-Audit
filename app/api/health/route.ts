/**
 * Health Check API
 * GET /api/health
 * 
 * This endpoint is used by:
 * - Docker health checks
 * - Load balancers
 * - Monitoring systems
 * - Kubernetes liveness/readiness probes
 * 
 * Returns:
 * - 200 OK: Service is healthy and ready to accept traffic
 * - 503 Service Unavailable: Service is unhealthy
 */

import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    // Basic health check - server is running and can respond
    const healthStatus = {
      status: "healthy",
      service: "open-audit-web-server",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || "development",
      version: process.env.npm_package_version || "unknown",
    };

    // Optional: Check Redis connection if REDIS_URL is configured
    // This is useful for the microservices architecture
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
        console.warn("[health] Redis check failed:", redisError.message);
        healthStatus.redis = { 
          connected: false, 
          error: redisError.message 
        };
        // Don't fail the health check if Redis is temporarily down
        // The server can still serve static content and handle API requests
      }
    }

    // Optional: Check database connection if using Prisma
    // Only attempt if database libraries are available
    try {
      if (process.env.DATABASE_URL) {
        const { db } = require("@/lib/db/client");
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
      console.warn("[health] Database check skipped:", dbError.message);
      // Database is optional in microservices architecture
      // Don't fail the health check if database libraries are not available
    }

    // Return 200 OK if we got this far
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
