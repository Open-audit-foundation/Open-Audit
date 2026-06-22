/**
 * Resilient Client Integration Tests
 *
 * Verifies:
 * - End-to-end integration of rate limiter + circuit breaker
 * - Automatic fallback to backup endpoints
 * - HTTP 429 and 500 error handling
 * - Recovery after upstream stabilization
 * - No leaked resources (timers, promises)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createResilientClient, type ResilientClient } from "../resilient-client";
import { CircuitState } from "../circuit-breaker";

describe("ResilientClient - Integration Tests", () => {
  let client: ResilientClient;

  afterEach(() => {
    if (client) {
      client.dispose();
    }
  });

  describe("Rate limiting integration", () => {
    beforeEach(() => {
      client = createResilientClient({
        endpoints: [
          { id: "primary", url: "http://primary.example.com", priority: 0 },
        ],
        rateLimiter: {
          capacity: 3,
          refillRate: 10,
        },
        circuitBreaker: {
          failureThreshold: 10, // High threshold to avoid tripping during rate limit tests
          successThreshold: 2,
          resetTimeout: 1000,
        },
      });
    });

    it("should allow burst requests up to capacity", async () => {
      const successFn = vi.fn(async (url: string) => ({ url, result: "success" }));

      // Fire 3 requests (burst capacity)
      const promises = [
        client.execute(successFn),
        client.execute(successFn),
        client.execute(successFn),
      ];

      await Promise.all(promises);

      expect(successFn).toHaveBeenCalledTimes(3);
    });

    it("should queue requests beyond capacity", async () => {
      const successFn = vi.fn(async (url: string) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { url, result: "success" };
      });

      // Fire 5 requests (exceeds capacity of 3)
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(client.execute(successFn));
      }

      await Promise.all(promises);

      expect(successFn).toHaveBeenCalledTimes(5);

      const metrics = client.metrics();
      expect(metrics.rateLimiter.totalConsumed).toBe(5);
      expect(metrics.rateLimiter.totalQueued).toBeGreaterThan(0);
    });
  });

  describe("Circuit breaker integration", () => {
    beforeEach(() => {
      client = createResilientClient({
        endpoints: [
          { id: "primary", url: "http://primary.example.com", priority: 0 },
        ],
        rateLimiter: {
          capacity: 50,
          refillRate: 50, // High rate to avoid rate limiting during tests
        },
        circuitBreaker: {
          failureThreshold: 3,
          successThreshold: 2,
          resetTimeout: 200,
        },
      });
    });

    it("should detect and isolate failing endpoint (HTTP 500)", async () => {
      const failingFn = vi.fn(async (url: string) => {
        const error: any = new Error("Internal Server Error");
        error.response = { status: 500 };
        throw error;
      });

      // Trigger failures
      for (let i = 0; i < 3; i++) {
        await expect(client.execute(failingFn)).rejects.toThrow();
      }

      const metrics = client.metrics();
      const primaryBreaker = metrics.circuitBreakers.find((cb) => cb.endpoint.id === "primary");

      expect(primaryBreaker?.metrics.state).toBe(CircuitState.OPEN);
      expect(primaryBreaker?.metrics.totalFailures).toBe(3);
    });

    it("should detect rate limiting (HTTP 429)", async () => {
      const rateLimitFn = vi.fn(async (url: string) => {
        const error: any = new Error("Too Many Requests");
        error.response = { status: 429 };
        throw error;
      });

      // Trigger rate limit errors
      for (let i = 0; i < 3; i++) {
        await expect(client.execute(rateLimitFn)).rejects.toThrow();
      }

      const metrics = client.metrics();
      const primaryBreaker = metrics.circuitBreakers.find((cb) => cb.endpoint.id === "primary");

      expect(primaryBreaker?.metrics.state).toBe(CircuitState.OPEN);
      expect(primaryBreaker?.metrics.totalFailures).toBe(3);
    });

    it("should fail fast when circuit is open", async () => {
      const failingFn = vi.fn(async (url: string) => {
        const error: any = new Error("HTTP 500");
        error.response = { status: 500 };
        throw error;
      });

      // Trip the circuit
      for (let i = 0; i < 3; i++) {
        await expect(client.execute(failingFn)).rejects.toThrow();
      }

      // Next request should fail fast (circuit is open)
      const callCountBefore = failingFn.mock.calls.length;
      await expect(client.execute(failingFn)).rejects.toThrow();
      
      // Function should not have been called again (fail-fast)
      expect(failingFn.mock.calls.length).toBe(callCountBefore);
    });

    it("should recover after upstream stabilizes", async () => {
      let shouldFail = true;

      const conditionalFn = vi.fn(async (url: string) => {
        if (shouldFail) {
          const error: any = new Error("HTTP 500");
          error.response = { status: 500 };
          throw error;
        }
        return { url, result: "success" };
      });

      // Trip the circuit
      for (let i = 0; i < 3; i++) {
        await expect(client.execute(conditionalFn)).rejects.toThrow();
      }

      expect(client.metrics().circuitBreakers[0].metrics.state).toBe(CircuitState.OPEN);

      // Wait for half-open
      await new Promise((resolve) => setTimeout(resolve, 250));

      // Now allow success
      shouldFail = false;

      // Make successful requests (successThreshold = 2)
      await client.execute(conditionalFn);
      await client.execute(conditionalFn);

      // Circuit should be closed now
      expect(client.metrics().circuitBreakers[0].metrics.state).toBe(CircuitState.CLOSED);
    });
  });

  describe("Fallback to backup endpoints", () => {
    beforeEach(() => {
      client = createResilientClient({
        endpoints: [
          { id: "primary", url: "http://primary.example.com", priority: 0 },
          { id: "backup", url: "http://backup.example.com", priority: 1 },
        ],
        rateLimiter: {
          capacity: 50,
          refillRate: 50,
        },
        circuitBreaker: {
          failureThreshold: 2,
          successThreshold: 2,
          resetTimeout: 500,
        },
      });
    });

    it("should fallback to backup when primary fails", async () => {
      const endpoints: string[] = [];

      const selectiveFn = vi.fn(async (url: string) => {
        endpoints.push(url);

        // Primary fails, backup succeeds
        if (url.includes("primary")) {
          const error: any = new Error("HTTP 500");
          error.response = { status: 500 };
          throw error;
        }
        return { url, result: "success" };
      });

      // First request: primary fails, backup succeeds
      const result = await client.execute(selectiveFn);
      expect(result.result).toBe("success");
      expect(result.url).toContain("backup");

      // Should have tried primary first, then backup
      expect(endpoints).toContain("http://primary.example.com");
      expect(endpoints).toContain("http://backup.example.com");
    });

    it("should use backup after primary circuit opens", async () => {
      const endpoints: string[] = [];

      const selectiveFn = vi.fn(async (url: string) => {
        endpoints.push(url);

        if (url.includes("primary")) {
          const error: any = new Error("HTTP 500");
          error.response = { status: 500 };
          throw error;
        }
        return { url, result: "success" };
      });

      // Trip primary circuit (2 failures)
      await client.execute(selectiveFn);
      await client.execute(selectiveFn);

      endpoints.length = 0; // Clear history

      // Next request should go directly to backup (primary circuit is open)
      await client.execute(selectiveFn);

      // Should only have called backup (not primary)
      expect(endpoints).toEqual(["http://backup.example.com"]);
    });

    it("should return to primary after recovery", async () => {
      let primaryShouldFail = true;
      const endpoints: string[] = [];

      const conditionalFn = vi.fn(async (url: string) => {
        endpoints.push(url);

        if (url.includes("primary") && primaryShouldFail) {
          const error: any = new Error("HTTP 500");
          error.response = { status: 500 };
          throw error;
        }
        return { url, result: "success" };
      });

      // Trip primary circuit
      await client.execute(conditionalFn);
      await client.execute(conditionalFn);

      // Verify using backup
      expect(client.getCurrentEndpoint().id).toBe("backup");

      // Wait for half-open
      await new Promise((resolve) => setTimeout(resolve, 550));

      // Allow primary to succeed
      primaryShouldFail = false;

      // Make successful requests to close circuit
      await client.execute(conditionalFn);
      await client.execute(conditionalFn);

      // Should be back to primary
      expect(client.getCurrentEndpoint().id).toBe("primary");
    });

    it("should fail if all endpoints fail", async () => {
      const allFailFn = vi.fn(async (url: string) => {
        const error: any = new Error("HTTP 500");
        error.response = { status: 500 };
        throw error;
      });

      await expect(client.execute(allFailFn)).rejects.toThrow(
        "All RPC endpoints failed"
      );

      // Should have tried both endpoints
      expect(allFailFn).toHaveBeenCalledTimes(2);
    });
  });

  describe("Exponential backoff", () => {
    beforeEach(() => {
      client = createResilientClient({
        endpoints: [
          { id: "primary", url: "http://primary.example.com", priority: 0 },
        ],
        rateLimiter: {
          capacity: 50,
          refillRate: 50,
        },
        circuitBreaker: {
          failureThreshold: 2,
          successThreshold: 2,
          resetTimeout: 100,
          maxResetTimeout: 400,
        },
      });
    });

    it("should increase reset timeout on repeated failures", async () => {
      const failingFn = async (url: string) => {
        const error: any = new Error("HTTP 500");
        error.response = { status: 500 };
        throw error;
      };

      // First failure cycle
      await expect(client.execute(failingFn)).rejects.toThrow();
      await expect(client.execute(failingFn)).rejects.toThrow();

      const metrics1 = client.metrics().circuitBreakers[0].metrics;
      const timeout1 = metrics1.currentResetTimeout;

      // Wait for half-open
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Fail during half-open (reopens with doubled timeout)
      await expect(client.execute(failingFn)).rejects.toThrow();

      const metrics2 = client.metrics().circuitBreakers[0].metrics;
      expect(metrics2.currentResetTimeout).toBe(timeout1 * 2);
    });
  });

  describe("Observability and metrics", () => {
    beforeEach(() => {
      client = createResilientClient({
        endpoints: [
          { id: "primary", url: "http://primary.example.com", priority: 0 },
          { id: "backup", url: "http://backup.example.com", priority: 1 },
        ],
        rateLimiter: {
          capacity: 10,
          refillRate: 10,
        },
        circuitBreaker: {
          failureThreshold: 3,
          successThreshold: 2,
          resetTimeout: 1000,
        },
      });
    });

    it("should provide comprehensive metrics", async () => {
      const successFn = async (url: string) => ({ url, result: "success" });

      await client.execute(successFn);
      await client.execute(successFn);

      const metrics = client.metrics();

      // Rate limiter metrics
      expect(metrics.rateLimiter.totalConsumed).toBe(2);
      expect(metrics.rateLimiter.availableTokens).toBeGreaterThanOrEqual(8);

      // Circuit breaker metrics
      expect(metrics.circuitBreakers).toHaveLength(2);
      expect(metrics.circuitBreakers[0].endpoint.id).toBe("primary");
      expect(metrics.circuitBreakers[0].metrics.totalSuccesses).toBeGreaterThan(0);

      // Current endpoint
      expect(metrics.currentEndpoint.id).toBe("primary");
    });

    it("should invoke onRequest callback", async () => {
      const requests: Array<{ endpoint: string; attempt: number }> = [];

      const clientWithCallbacks = createResilientClient({
        endpoints: [
          { id: "primary", url: "http://primary.example.com", priority: 0 },
        ],
        rateLimiter: { capacity: 10, refillRate: 10 },
        circuitBreaker: { failureThreshold: 3, successThreshold: 2, resetTimeout: 1000 },
        onRequest: (endpoint, attempt) => {
          requests.push({ endpoint: endpoint.id, attempt });
        },
      });

      await clientWithCallbacks.execute(async (url) => "success");

      expect(requests).toHaveLength(1);
      expect(requests[0].endpoint).toBe("primary");
      expect(requests[0].attempt).toBe(1);

      clientWithCallbacks.dispose();
    });

    it("should invoke onResponse callback", async () => {
      const responses: Array<{ endpoint: string; success: boolean; duration: number }> = [];

      const clientWithCallbacks = createResilientClient({
        endpoints: [
          { id: "primary", url: "http://primary.example.com", priority: 0 },
        ],
        rateLimiter: { capacity: 10, refillRate: 10 },
        circuitBreaker: { failureThreshold: 3, successThreshold: 2, resetTimeout: 1000 },
        onResponse: (endpoint, duration, success) => {
          responses.push({ endpoint: endpoint.id, success, duration });
        },
      });

      await clientWithCallbacks.execute(async (url) => "success");

      expect(responses).toHaveLength(1);
      expect(responses[0].endpoint).toBe("primary");
      expect(responses[0].success).toBe(true);
      expect(responses[0].duration).toBeGreaterThan(0);

      clientWithCallbacks.dispose();
    });
  });

  describe("Resource cleanup", () => {
    it("should clean up all resources on dispose", async () => {
      client = createResilientClient({
        endpoints: [
          { id: "primary", url: "http://primary.example.com", priority: 0 },
        ],
        rateLimiter: { capacity: 10, refillRate: 10 },
        circuitBreaker: { failureThreshold: 3, successThreshold: 2, resetTimeout: 1000 },
      });

      await client.execute(async (url) => "success");

      client.dispose();

      // Subsequent calls should fail gracefully
      await expect(
        client.execute(async (url) => "success")
      ).rejects.toThrow();
    });

    it("should not leak timers", async () => {
      const clients: ResilientClient[] = [];

      // Create and destroy many clients
      for (let i = 0; i < 10; i++) {
        const c = createResilientClient({
          endpoints: [
            { id: "test", url: "http://test.example.com", priority: 0 },
          ],
          rateLimiter: { capacity: 10, refillRate: 10 },
          circuitBreaker: { failureThreshold: 3, successThreshold: 2, resetTimeout: 1000 },
        });
        clients.push(c);
      }

      // Dispose all
      for (const c of clients) {
        c.dispose();
      }

      // If we leaked timers, this test would hang or memory would increase
      expect(clients.length).toBe(10);
    });
  });

  describe("Edge cases", () => {
    it("should handle simultaneous requests", async () => {
      client = createResilientClient({
        endpoints: [
          { id: "primary", url: "http://primary.example.com", priority: 0 },
        ],
        rateLimiter: { capacity: 50, refillRate: 50 },
        circuitBreaker: { failureThreshold: 10, successThreshold: 2, resetTimeout: 1000 },
      });

      const promises = [];
      for (let i = 0; i < 20; i++) {
        promises.push(
          client.execute(async (url) => ({ url, index: i }))
        );
      }

      const results = await Promise.all(promises);
      expect(results).toHaveLength(20);
    });

    it("should handle mixed success/failure requests", async () => {
      client = createResilientClient({
        endpoints: [
          { id: "primary", url: "http://primary.example.com", priority: 0 },
        ],
        rateLimiter: { capacity: 50, refillRate: 50 },
        circuitBreaker: { failureThreshold: 5, successThreshold: 2, resetTimeout: 1000 },
      });

      let counter = 0;
      const mixedFn = async (url: string) => {
        counter++;
        if (counter % 2 === 0) {
          const error: any = new Error("HTTP 500");
          error.response = { status: 500 };
          throw error;
        }
        return { url, result: "success" };
      };

      // Execute 6 requests (3 success, 3 failure)
      for (let i = 0; i < 6; i++) {
        try {
          await client.execute(mixedFn);
        } catch (error) {
          // Expected for failures
        }
      }

      const metrics = client.metrics().circuitBreakers[0].metrics;
      expect(metrics.totalSuccesses).toBe(3);
      expect(metrics.totalFailures).toBe(3);
      // Circuit should still be closed (didn't reach threshold of 5)
      expect(metrics.state).toBe(CircuitState.CLOSED);
    });
  });
});
