/**
 * Circuit Breaker Integration Tests
 *
 * Verifies:
 * - Automatic state transitions (CLOSED → OPEN → HALF_OPEN → CLOSED)
 * - Failure threshold detection
 * - Exponential backoff
 * - Canary request testing
 * - Proper cleanup (no leaked timers)
 */

import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from "vitest";
import {
  createCircuitBreaker,
  CircuitState,
  CircuitBreakerOpenError,
  type CircuitBreaker,
} from "../circuit-breaker";

describe("CircuitBreaker", () => {
  let breaker: CircuitBreaker;

  afterEach(() => {
    if (breaker) {
      breaker.dispose();
    }
  });

  describe("CLOSED state (normal operation)", () => {
    beforeEach(() => {
      breaker = createCircuitBreaker({
        failureThreshold: 3,
        successThreshold: 2,
        resetTimeout: 1000,
      });
    });

    it("should start in CLOSED state", () => {
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });

    it("should allow successful requests through", async () => {
      const result = await breaker.execute(async () => "success");
      expect(result).toBe("success");

      const metrics = breaker.metrics();
      expect(metrics.totalSuccesses).toBe(1);
      expect(metrics.totalFailures).toBe(0);
    });

    it("should track consecutive failures", async () => {
      const failingFn = async () => {
        const error: any = new Error("HTTP 500");
        error.response = { status: 500 };
        throw error;
      };

      for (let i = 0; i < 2; i++) {
        await expect(breaker.execute(failingFn)).rejects.toThrow("HTTP 500");
      }

      const metrics = breaker.metrics();
      expect(metrics.consecutiveFailures).toBe(2);
      expect(metrics.state).toBe(CircuitState.CLOSED);
    });
  });

  describe("CLOSED → OPEN transition", () => {
    beforeEach(() => {
      breaker = createCircuitBreaker({
        failureThreshold: 3,
        successThreshold: 2,
        resetTimeout: 1000,
      });
    });

    it("should open after reaching failure threshold", async () => {
      const failingFn = async () => {
        const error: any = new Error("HTTP 500");
        error.response = { status: 500 };
        throw error;
      };

      // Trigger 3 failures (threshold)
      for (let i = 0; i < 3; i++) {
        await expect(breaker.execute(failingFn)).rejects.toThrow();
      }

      expect(breaker.getState()).toBe(CircuitState.OPEN);
    });

    it("should detect HTTP 429 as failure", async () => {
      const rateLimitFn = async () => {
        const error: any = new Error("Too Many Requests");
        error.response = { status: 429 };
        throw error;
      };

      for (let i = 0; i < 3; i++) {
        await expect(breaker.execute(rateLimitFn)).rejects.toThrow();
      }

      expect(breaker.getState()).toBe(CircuitState.OPEN);
    });

    it("should detect timeout errors as failures", async () => {
      const timeoutFn = async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        const error: any = new Error("Request timeout");
        error.name = "TimeoutError";
        throw error;
      };

      for (let i = 0; i < 3; i++) {
        await expect(breaker.execute(timeoutFn)).rejects.toThrow();
      }

      expect(breaker.getState()).toBe(CircuitState.OPEN);
    });

    it("should NOT count non-failure errors toward threshold", async () => {
      const nonFailureFn = async () => {
        const error: any = new Error("Validation error");
        error.response = { status: 400 }; // Client error, not server
        throw error;
      };

      for (let i = 0; i < 5; i++) {
        await expect(breaker.execute(nonFailureFn)).rejects.toThrow();
      }

      // Should still be closed because 400 errors don't trip circuit
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });
  });

  describe("OPEN state (fail-fast)", () => {
    beforeEach(() => {
      breaker = createCircuitBreaker({
        failureThreshold: 2,
        successThreshold: 2,
        resetTimeout: 1000,
      });
    });

    it("should fail fast when circuit is OPEN", async () => {
      const failingFn = async () => {
        const error: any = new Error("HTTP 500");
        error.response = { status: 500 };
        throw error;
      };

      // Trip the circuit
      await expect(breaker.execute(failingFn)).rejects.toThrow();
      await expect(breaker.execute(failingFn)).rejects.toThrow();

      expect(breaker.getState()).toBe(CircuitState.OPEN);

      // Next request should fail immediately without calling the function
      const spyFn = vi.fn(failingFn);
      await expect(breaker.execute(spyFn)).rejects.toThrow(CircuitBreakerOpenError);

      // Function should not have been called (fail-fast)
      expect(spyFn).not.toHaveBeenCalled();
    });

    it("should use fallback when circuit is OPEN", async () => {
      const breakerWithFallback = createCircuitBreaker({
        failureThreshold: 2,
        successThreshold: 2,
        resetTimeout: 1000,
        fallback: async () => "fallback-result",
      });

      const failingFn = async () => {
        const error: any = new Error("HTTP 500");
        error.response = { status: 500 };
        throw error;
      };

      // Trip the circuit
      await expect(breakerWithFallback.execute(failingFn)).rejects.toThrow();
      await expect(breakerWithFallback.execute(failingFn)).rejects.toThrow();

      // Circuit is now open, should use fallback
      const result = await breakerWithFallback.execute(failingFn);
      expect(result).toBe("fallback-result");

      breakerWithFallback.dispose();
    });
  });

  describe("OPEN → HALF_OPEN transition (recovery)", () => {
    beforeEach(() => {
      breaker = createCircuitBreaker({
        failureThreshold: 2,
        successThreshold: 2,
        resetTimeout: 100, // Short for testing
      });
    });

    it("should transition to HALF_OPEN after reset timeout", async () => {
      const failingFn = async () => {
        const error: any = new Error("HTTP 500");
        error.response = { status: 500 };
        throw error;
      };

      // Trip the circuit
      await expect(breaker.execute(failingFn)).rejects.toThrow();
      await expect(breaker.execute(failingFn)).rejects.toThrow();
      expect(breaker.getState()).toBe(CircuitState.OPEN);

      // Wait for reset timeout
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);
    });
  });

  describe("HALF_OPEN state (canary testing)", () => {
    beforeEach(() => {
      breaker = createCircuitBreaker({
        failureThreshold: 2,
        successThreshold: 2,
        resetTimeout: 100,
      });
    });

    it("should close circuit after successThreshold successes", async () => {
      const failingFn = async () => {
        const error: any = new Error("HTTP 500");
        error.response = { status: 500 };
        throw error;
      };

      // Trip the circuit
      await expect(breaker.execute(failingFn)).rejects.toThrow();
      await expect(breaker.execute(failingFn)).rejects.toThrow();
      expect(breaker.getState()).toBe(CircuitState.OPEN);

      // Wait for HALF_OPEN
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);

      // Success threshold is 2, so 2 successful requests should close it
      const successFn = async () => "success";
      await breaker.execute(successFn);
      expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);

      await breaker.execute(successFn);
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });

    it("should reopen circuit if canary request fails", async () => {
      const failingFn = async () => {
        const error: any = new Error("HTTP 500");
        error.response = { status: 500 };
        throw error;
      };

      // Trip the circuit
      await expect(breaker.execute(failingFn)).rejects.toThrow();
      await expect(breaker.execute(failingFn)).rejects.toThrow();

      // Wait for HALF_OPEN
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);

      // Single failure in HALF_OPEN should reopen
      await expect(breaker.execute(failingFn)).rejects.toThrow();
      expect(breaker.getState()).toBe(CircuitState.OPEN);
    });

    it("should apply exponential backoff after reopening", async () => {
      const failingFn = async () => {
        const error: any = new Error("HTTP 500");
        error.response = { status: 500 };
        throw error;
      };

      // Trip the circuit
      await expect(breaker.execute(failingFn)).rejects.toThrow();
      await expect(breaker.execute(failingFn)).rejects.toThrow();

      const metrics1 = breaker.metrics();
      const initialTimeout = metrics1.currentResetTimeout;

      // Wait for HALF_OPEN
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Fail the canary request
      await expect(breaker.execute(failingFn)).rejects.toThrow();
      expect(breaker.getState()).toBe(CircuitState.OPEN);

      const metrics2 = breaker.metrics();
      // Timeout should have doubled
      expect(metrics2.currentResetTimeout).toBe(initialTimeout * 2);
    });
  });

  describe("Metrics and observability", () => {
    beforeEach(() => {
      breaker = createCircuitBreaker({
        failureThreshold: 3,
        successThreshold: 2,
        resetTimeout: 1000,
      });
    });

    it("should track comprehensive metrics", async () => {
      const successFn = async () => "success";
      const failingFn = async () => {
        const error: any = new Error("HTTP 500");
        error.response = { status: 500 };
        throw error;
      };

      await breaker.execute(successFn);
      await expect(breaker.execute(failingFn)).rejects.toThrow();

      const metrics = breaker.metrics();
      expect(metrics.totalRequests).toBe(2);
      expect(metrics.totalSuccesses).toBe(1);
      expect(metrics.totalFailures).toBe(1);
      expect(metrics.lastSuccessTime).toBeDefined();
      expect(metrics.lastFailureTime).toBeDefined();
    });

    it("should invoke onStateChange listener", async () => {
      const stateChanges: Array<{ from: CircuitState; to: CircuitState }> = [];

      const breakerWithListener = createCircuitBreaker({
        failureThreshold: 2,
        successThreshold: 2,
        resetTimeout: 100,
        onStateChange: (oldState, newState) => {
          stateChanges.push({ from: oldState, to: newState });
        },
      });

      const failingFn = async () => {
        const error: any = new Error("HTTP 500");
        error.response = { status: 500 };
        throw error;
      };

      // Trip the circuit
      await expect(breakerWithListener.execute(failingFn)).rejects.toThrow();
      await expect(breakerWithListener.execute(failingFn)).rejects.toThrow();

      expect(stateChanges).toHaveLength(1);
      expect(stateChanges[0]).toEqual({
        from: CircuitState.CLOSED,
        to: CircuitState.OPEN,
      });

      breakerWithListener.dispose();
    });
  });

  describe("Resource cleanup", () => {
    it("should clean up timers on dispose", async () => {
      breaker = createCircuitBreaker({
        failureThreshold: 2,
        successThreshold: 2,
        resetTimeout: 100,
      });

      const failingFn = async () => {
        const error: any = new Error("HTTP 500");
        error.response = { status: 500 };
        throw error;
      };

      // Trip the circuit (starts reset timer)
      await expect(breaker.execute(failingFn)).rejects.toThrow();
      await expect(breaker.execute(failingFn)).rejects.toThrow();

      // Dispose immediately
      breaker.dispose();

      // Wait longer than reset timeout
      await new Promise((resolve) => setTimeout(resolve, 200));

      // State should still be OPEN (timer was cancelled)
      expect(breaker.getState()).toBe(CircuitState.OPEN);
    });

    it("should prevent execution after dispose", async () => {
      breaker = createCircuitBreaker({
        failureThreshold: 3,
        successThreshold: 2,
        resetTimeout: 1000,
      });

      breaker.dispose();

      await expect(breaker.execute(async () => "test")).rejects.toThrow(
        "CircuitBreaker has been disposed"
      );
    });
  });

  describe("Manual control", () => {
    beforeEach(() => {
      breaker = createCircuitBreaker({
        failureThreshold: 3,
        successThreshold: 2,
        resetTimeout: 1000,
      });
    });

    it("should allow manual open", () => {
      breaker.open();
      expect(breaker.getState()).toBe(CircuitState.OPEN);
    });

    it("should allow manual close", async () => {
      const failingFn = async () => {
        const error: any = new Error("HTTP 500");
        error.response = { status: 500 };
        throw error;
      };

      // Trip the circuit
      for (let i = 0; i < 3; i++) {
        await expect(breaker.execute(failingFn)).rejects.toThrow();
      }
      expect(breaker.getState()).toBe(CircuitState.OPEN);

      // Manually close
      breaker.close();
      expect(breaker.getState()).toBe(CircuitState.CLOSED);

      // Should work normally now
      await breaker.execute(async () => "success");
    });

    it("should allow manual half-open", () => {
      breaker.halfOpen();
      expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);
    });
  });
});

describe("Structured log events", () => {
  let consoleSpy: MockInstance;
  let logBreaker: CircuitBreaker;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    if (logBreaker) logBreaker.dispose();
  });

  /**
   * Acceptance criterion: 5 consecutive simulated RPC failures produce a
   * visible "circuit breaker opened" log line with cause.
   */
  it("emits circuit_breaker_state_change log with cause when circuit opens after 5 failures", async () => {
    logBreaker = createCircuitBreaker({
      failureThreshold: 5,
      successThreshold: 2,
      resetTimeout: 100,
    });

    const failingFn = async () => {
      const err: any = new Error("HTTP 500");
      err.response = { status: 500 };
      throw err;
    };

    for (let i = 0; i < 5; i++) {
      await expect(logBreaker.execute(failingFn)).rejects.toThrow();
    }

    expect(logBreaker.getState()).toBe(CircuitState.OPEN);

    const jsonCalls = consoleSpy.mock.calls
      .map((args) => {
        try { return JSON.parse(args[0]); } catch { return null; }
      })
      .filter(Boolean);

    const openEvent = jsonCalls.find(
      (e) => e.event === "circuit_breaker_state_change" && e.newState === "OPEN"
    );

    expect(openEvent).toBeDefined();
    expect(openEvent.oldState).toBe("CLOSED");
    expect(openEvent.reason).toMatch(/consecutiveFailures.*5.*failureThreshold.*5/);
    expect(openEvent.consecutiveFailures).toBe(5);
    expect(openEvent.timestamp).toBeDefined();
  });

  /**
   * Acceptance criterion: half-open → closed recovery transition is also logged.
   */
  it("emits circuit_breaker_state_change log for HALF_OPEN → CLOSED recovery", async () => {
    logBreaker = createCircuitBreaker({
      failureThreshold: 2,
      successThreshold: 2,
      resetTimeout: 80,
    });

    const failingFn = async () => {
      const err: any = new Error("HTTP 500");
      err.response = { status: 500 };
      throw err;
    };

    // Open the circuit
    await expect(logBreaker.execute(failingFn)).rejects.toThrow();
    await expect(logBreaker.execute(failingFn)).rejects.toThrow();

    // Wait for HALF_OPEN
    await new Promise((r) => setTimeout(r, 120));
    expect(logBreaker.getState()).toBe(CircuitState.HALF_OPEN);

    // Reset spy so we only see the recovery log
    consoleSpy.mockClear();

    // Two successes → CLOSED
    await logBreaker.execute(async () => "ok");
    await logBreaker.execute(async () => "ok");

    expect(logBreaker.getState()).toBe(CircuitState.CLOSED);

    const jsonCalls = consoleSpy.mock.calls
      .map((args) => {
        try { return JSON.parse(args[0]); } catch { return null; }
      })
      .filter(Boolean);

    const recoveryEvent = jsonCalls.find(
      (e) =>
        e.event === "circuit_breaker_state_change" &&
        e.oldState === "HALF_OPEN" &&
        e.newState === "CLOSED"
    );

    expect(recoveryEvent).toBeDefined();
    expect(recoveryEvent.reason).toMatch(/recovery confirmed/);
    expect(recoveryEvent.timestamp).toBeDefined();
  });

  /**
   * Acceptance criterion: OPEN → HALF_OPEN transition is also logged (reset timeout hit).
   */
  it("emits circuit_breaker_state_change log for OPEN → HALF_OPEN timeout", async () => {
    logBreaker = createCircuitBreaker({
      failureThreshold: 2,
      successThreshold: 2,
      resetTimeout: 80,
    });

    const failingFn = async () => {
      const err: any = new Error("HTTP 500");
      err.response = { status: 500 };
      throw err;
    };

    await expect(logBreaker.execute(failingFn)).rejects.toThrow();
    await expect(logBreaker.execute(failingFn)).rejects.toThrow();

    consoleSpy.mockClear();

    await new Promise((r) => setTimeout(r, 120));
    expect(logBreaker.getState()).toBe(CircuitState.HALF_OPEN);

    const jsonCalls = consoleSpy.mock.calls
      .map((args) => {
        try { return JSON.parse(args[0]); } catch { return null; }
      })
      .filter(Boolean);

    const halfOpenEvent = jsonCalls.find(
      (e) =>
        e.event === "circuit_breaker_state_change" &&
        e.oldState === "OPEN" &&
        e.newState === "HALF_OPEN"
    );

    expect(halfOpenEvent).toBeDefined();
    expect(halfOpenEvent.reason).toMatch(/resetTimeout/);
    expect(halfOpenEvent.timestamp).toBeDefined();
  });
});
