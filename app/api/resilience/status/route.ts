import { NextResponse } from "next/server";
import { getResilientMetrics, getHealthStatus } from "@/lib/stellar/resilient-stellar-client";

export async function GET() {
  try {
    const metrics = getResilientMetrics();
    const health = getHealthStatus();

    const circuitBreakers = metrics.circuitBreakers.map((cb) => ({
      endpoint: cb.endpoint.id,
      url: cb.endpoint.url,
      state: cb.metrics.state,
      consecutiveFailures: cb.metrics.consecutiveFailures,
      consecutiveSuccesses: cb.metrics.consecutiveSuccesses,
      totalRequests: cb.metrics.totalRequests,
      totalSuccesses: cb.metrics.totalSuccesses,
      totalFailures: cb.metrics.totalFailures,
      totalTimeouts: cb.metrics.totalTimeouts,
      totalFallbacks: cb.metrics.totalFallbacks,
      currentResetTimeoutMs: cb.metrics.currentResetTimeout,
      lastFailureTime: cb.metrics.lastFailureTime
        ? new Date(cb.metrics.lastFailureTime).toISOString()
        : null,
      lastSuccessTime: cb.metrics.lastSuccessTime
        ? new Date(cb.metrics.lastSuccessTime).toISOString()
        : null,
    }));

    const tokenBucket = {
      availableTokens: metrics.rateLimiter.availableTokens,
      queuedRequests: metrics.rateLimiter.queuedRequests,
      totalConsumed: metrics.rateLimiter.totalConsumed,
      totalQueued: metrics.rateLimiter.totalQueued,
      totalRejected: metrics.rateLimiter.totalRejected,
    };

    return NextResponse.json(
      {
        status: "success",
        timestamp: new Date().toISOString(),
        currentEndpoint: metrics.currentEndpoint.id,
        health,
        circuitBreakers,
        tokenBucket,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-cache, no-store, must-revalidate",
        },
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
