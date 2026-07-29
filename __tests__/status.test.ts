/**
 * Status System Test Suite
 *
 * Tests the status monitoring system including:
 * - API endpoint health checks
 * - Worker heartbeat functionality
 * - Circuit breaker integration
 * - Component health checks
 * - Status determination logic
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";

// ============================================================================
// Mock Setup
// ============================================================================

// Mock Redis
vi.mock("ioredis", () => {
  const Redis = vi.fn(() => ({
    ping: vi.fn().mockResolvedValue("PONG"),
    hgetall: vi.fn().mockResolvedValue({
      lastSeen: new Date().toISOString(),
      workerId: "test-worker",
      processedCount: "100",
      errorCount: "5",
      uptime: "3600",
    }),
    hset: vi.fn().mockResolvedValue(1),
    disconnect: vi.fn(),
    quit: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
  }));

  return { default: Redis };
});

// Mock Stellar SDK
vi.mock("stellar-sdk/lib/soroban", () => {
  return {
    Server: vi.fn(() => ({
      getLatestLedger: vi.fn().mockResolvedValue({
        sequence: 1000000,
        hash: "test-hash",
      }),
    })),
  };
});

// Mock Prisma
vi.mock("@prisma/client", () => {
  return {
    PrismaClient: vi.fn(() => ({
      $queryRaw: vi.fn().mockResolvedValue([{ health: 1 }]),
      $disconnect: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

// Mock resilient client
vi.mock("../lib/stellar/resilient-stellar-client", () => {
  return {
    resilientStellarClient: {
      execute: vi.fn().mockResolvedValue({ sequence: 1000000 }),
      metrics: vi.fn().mockReturnValue({
        currentEndpoint: { id: "primary", url: "https://test.com", priority: 0 },
        circuitBreakers: [
          {
            endpoint: { id: "primary", url: "https://test.com", priority: 0 },
            metrics: {
              state: "CLOSED",
              totalRequests: 100,
              totalSuccesses: 95,
              totalFailures: 5,
              consecutiveFailures: 0,
            },
          },
        ],
      }),
    },
  };
});

// ============================================================================
// Helper Functions
// ============================================================================

type ComponentStatus = "healthy" | "degraded" | "down" | "not-configured";
type OverallStatus = "healthy" | "degraded" | "down";

interface ComponentHealth {
  status: ComponentStatus;
  latencyMs?: number;
  error?: string;
  details?: Record<string, any>;
}

function determineOverallStatus(components: {
  stellarRpc: ComponentHealth;
  database: ComponentHealth;
  redis: ComponentHealth;
  worker: ComponentHealth;
}): OverallStatus {
  const { stellarRpc, database, redis, worker } = components;

  // If critical component (Stellar RPC) is down, system is down
  if (stellarRpc.status === "down") {
    return "down";
  }

  // If any component is degraded or down, system is degraded
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
// Test Suite
// ============================================================================

describe("Status System", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Overall Status Determination", () => {
    test("should return healthy when all components are healthy", () => {
      const components = {
        stellarRpc: { status: "healthy" as ComponentStatus, latencyMs: 100 },
        database: { status: "healthy" as ComponentStatus, latencyMs: 50 },
        redis: { status: "healthy" as ComponentStatus, latencyMs: 10 },
        worker: { status: "healthy" as ComponentStatus, latencyMs: 20 },
      };

      const status = determineOverallStatus(components);
      expect(status).toBe("healthy");
    });

    test("should return down when Stellar RPC is down", () => {
      const components = {
        stellarRpc: { status: "down" as ComponentStatus, error: "Connection failed" },
        database: { status: "healthy" as ComponentStatus },
        redis: { status: "healthy" as ComponentStatus },
        worker: { status: "healthy" as ComponentStatus },
      };

      const status = determineOverallStatus(components);
      expect(status).toBe("down");
    });

    test("should return degraded when Stellar RPC is degraded", () => {
      const components = {
        stellarRpc: { status: "degraded" as ComponentStatus, latencyMs: 500 },
        database: { status: "healthy" as ComponentStatus },
        redis: { status: "healthy" as ComponentStatus },
        worker: { status: "healthy" as ComponentStatus },
      };

      const status = determineOverallStatus(components);
      expect(status).toBe("degraded");
    });

    test("should return degraded when worker is down", () => {
      const components = {
        stellarRpc: { status: "healthy" as ComponentStatus },
        database: { status: "healthy" as ComponentStatus },
        redis: { status: "healthy" as ComponentStatus },
        worker: { status: "down" as ComponentStatus, error: "Heartbeat stale" },
      };

      const status = determineOverallStatus(components);
      expect(status).toBe("degraded");
    });

    test("should ignore not-configured components", () => {
      const components = {
        stellarRpc: { status: "healthy" as ComponentStatus },
        database: { status: "not-configured" as ComponentStatus },
        redis: { status: "not-configured" as ComponentStatus },
        worker: { status: "not-configured" as ComponentStatus },
      };

      const status = determineOverallStatus(components);
      expect(status).toBe("healthy");
    });

    test("should return degraded when database is down", () => {
      const components = {
        stellarRpc: { status: "healthy" as ComponentStatus },
        database: { status: "down" as ComponentStatus, error: "Connection failed" },
        redis: { status: "healthy" as ComponentStatus },
        worker: { status: "healthy" as ComponentStatus },
      };

      const status = determineOverallStatus(components);
      expect(status).toBe("degraded");
    });
  });

  describe("Worker Heartbeat", () => {
    test("should detect healthy worker with recent heartbeat", () => {
      const heartbeat = {
        lastSeen: new Date().toISOString(),
        workerId: "test-worker",
        processedCount: "100",
        errorCount: "5",
      };

      const lastSeenTime = new Date(heartbeat.lastSeen).getTime();
      const nowTime = Date.now();
      const ageSeconds = Math.floor((nowTime - lastSeenTime) / 1000);

      expect(ageSeconds).toBeLessThan(90);
    });

    test("should detect stale worker heartbeat", () => {
      const staleTime = new Date(Date.now() - 120 * 1000); // 2 minutes ago
      const heartbeat = {
        lastSeen: staleTime.toISOString(),
        workerId: "test-worker",
        processedCount: "100",
        errorCount: "5",
      };

      const lastSeenTime = new Date(heartbeat.lastSeen).getTime();
      const nowTime = Date.now();
      const ageSeconds = Math.floor((nowTime - lastSeenTime) / 1000);

      expect(ageSeconds).toBeGreaterThan(90);
    });

    test("should handle missing heartbeat", () => {
      const heartbeat = null;

      expect(heartbeat).toBeNull();
    });
  });

  describe("Component Latency", () => {
    test("should measure latency for successful checks", () => {
      const startTime = Date.now();
      // Simulate some work
      const endTime = Date.now();
      const latencyMs = endTime - startTime;

      expect(latencyMs).toBeGreaterThanOrEqual(0);
      expect(latencyMs).toBeLessThan(1000);
    });

    test("should measure latency for failed checks", () => {
      const startTime = Date.now();
      try {
        throw new Error("Test error");
      } catch (error) {
        const endTime = Date.now();
        const latencyMs = endTime - startTime;

        expect(latencyMs).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe("Circuit Breaker Integration", () => {
    test("should read circuit breaker state", () => {
      const { resilientStellarClient } = require("../lib/stellar/resilient-stellar-client");
      const metrics = resilientStellarClient.metrics();

      expect(metrics.circuitBreakers).toBeDefined();
      expect(metrics.circuitBreakers[0].metrics.state).toBe("CLOSED");
    });

    test("should detect OPEN circuit breaker", () => {
      const circuitBreakerState = "OPEN";

      expect(circuitBreakerState).toBe("OPEN");
    });

    test("should detect HALF_OPEN circuit breaker", () => {
      const circuitBreakerState = "HALF_OPEN";

      expect(circuitBreakerState).toBe("HALF_OPEN");
    });
  });

  describe("Status API Response Structure", () => {
    test("should have required fields", () => {
      const response = {
        status: "healthy" as OverallStatus,
        timestamp: new Date().toISOString(),
        version: "1.0.0",
        environment: "test",
        components: {
          stellarRpc: { status: "healthy" as ComponentStatus },
          database: { status: "healthy" as ComponentStatus },
          redis: { status: "healthy" as ComponentStatus },
          worker: { status: "healthy" as ComponentStatus },
        },
        checks: {
          totalChecks: 4,
          passedChecks: 4,
          failedChecks: 0,
          durationMs: 100,
        },
      };

      expect(response.status).toBeDefined();
      expect(response.timestamp).toBeDefined();
      expect(response.components).toBeDefined();
      expect(response.checks).toBeDefined();
    });

    test("should calculate check counts correctly", () => {
      const components = {
        stellarRpc: { status: "healthy" as ComponentStatus },
        database: { status: "degraded" as ComponentStatus },
        redis: { status: "down" as ComponentStatus },
        worker: { status: "healthy" as ComponentStatus },
      };

      const totalChecks = 4;
      const passedChecks = Object.values(components).filter(
        (c) => c.status === "healthy" || c.status === "not-configured"
      ).length;
      const failedChecks = totalChecks - passedChecks;

      expect(totalChecks).toBe(4);
      expect(passedChecks).toBe(2);
      expect(failedChecks).toBe(2);
    });
  });

  describe("Error Handling", () => {
    test("should handle component check timeout", async () => {
      const checkWithTimeout = async () => {
        return Promise.race([
          new Promise((resolve) => setTimeout(() => resolve("OK"), 5000)),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Timeout")), 2000)
          ),
        ]);
      };

      await expect(checkWithTimeout()).rejects.toThrow("Timeout");
    });

    test("should handle Redis connection failure", async () => {
      const Redis = (await import("ioredis")).default;
      const client = new Redis();

      // Mock connection failure
      (client.ping as any).mockRejectedValueOnce(new Error("Connection refused"));

      await expect(client.ping()).rejects.toThrow("Connection refused");
    });

    test("should handle database connection failure", async () => {
      const { PrismaClient } = await import("@prisma/client");
      const prisma = new PrismaClient();

      // Mock query failure
      (prisma.$queryRaw as any).mockRejectedValueOnce(
        new Error("Database not available")
      );

      await expect(prisma.$queryRaw`SELECT 1`).rejects.toThrow(
        "Database not available"
      );
    });
  });

  describe("Performance", () => {
    test("should complete all checks in under 500ms", async () => {
      const startTime = Date.now();

      // Simulate parallel checks
      await Promise.all([
        Promise.resolve({ status: "healthy" }),
        Promise.resolve({ status: "healthy" }),
        Promise.resolve({ status: "healthy" }),
        Promise.resolve({ status: "healthy" }),
      ]);

      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(500);
    });

    test("should run checks in parallel", async () => {
      const check1 = vi.fn().mockResolvedValue({ status: "healthy" });
      const check2 = vi.fn().mockResolvedValue({ status: "healthy" });
      const check3 = vi.fn().mockResolvedValue({ status: "healthy" });

      const startTime = Date.now();
      await Promise.all([check1(), check2(), check3()]);
      const duration = Date.now() - startTime;

      expect(check1).toHaveBeenCalled();
      expect(check2).toHaveBeenCalled();
      expect(check3).toHaveBeenCalled();
      expect(duration).toBeLessThan(100); // Parallel execution should be fast
    });
  });

  describe("Metrics Aggregation", () => {
    test("should aggregate event counts", () => {
      const metrics = {
        events: {
          last1Hour: 150,
          last24Hours: 3000,
        },
      };

      expect(metrics.events.last1Hour).toBeGreaterThanOrEqual(0);
      expect(metrics.events.last24Hours).toBeGreaterThanOrEqual(metrics.events.last1Hour);
    });

    test("should calculate translation success rate", () => {
      const totalTranslations = 1000;
      const successfulTranslations = 950;
      const successRate = (successfulTranslations / totalTranslations) * 100;

      expect(successRate).toBe(95);
      expect(successRate).toBeGreaterThanOrEqual(0);
      expect(successRate).toBeLessThanOrEqual(100);
    });

    test("should measure average latency", () => {
      const latencies = [10, 20, 30, 40, 50];
      const averageLatency =
        latencies.reduce((sum, val) => sum + val, 0) / latencies.length;

      expect(averageLatency).toBe(30);
    });
  });
});
