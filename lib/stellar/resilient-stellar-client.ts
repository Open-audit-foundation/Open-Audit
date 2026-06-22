/**
 * Resilient Stellar RPC Client
 *
 * Drop-in replacement for direct Stellar SDK calls with built-in resilience:
 * - Token-bucket rate limiting
 * - Circuit breaker pattern
 * - Automatic fallback to backup nodes
 * - Exponential backoff on failures
 *
 * Usage:
 * Replace direct SorobanRpc.Server calls with this client to get automatic
 * protection against rate limits and upstream failures.
 */

import { createResilientClient, type ResilientClient } from "../resilience/resilient-client";
import { getResilientClientConfig } from "../resilience/config";
import { eventResponseToRawEvent } from "./events";
import type { RawEvent } from "../translator/types";
import { StellarNetworkException } from "../errors";
import { captureExceptionSync } from "../telemetry";

/**
 * Singleton resilient client instance.
 * Shared across all Stellar RPC calls to maintain unified circuit breaker state.
 */
let resilientClient: ResilientClient | null = null;

/**
 * Gets or creates the singleton resilient client.
 */
function getResilientClient(): ResilientClient {
  if (!resilientClient) {
    const network = (process.env.NEXT_PUBLIC_NETWORK as any) ?? "testnet";
    const environment = (process.env.NODE_ENV === "production"
      ? "production"
      : process.env.NODE_ENV === "test"
      ? "staging"
      : "development") as "development" | "staging" | "production";

    const config = getResilientClientConfig(network, environment);

    resilientClient = createResilientClient({
      ...config,
      onRequest: (endpoint, attempt) => {
        console.log(`[stellar-rpc] → ${endpoint.id} (attempt ${attempt})`);
      },
      onResponse: (endpoint, duration, success) => {
        const status = success ? "✓" : "✗";
        console.log(`[stellar-rpc] ${status} ${endpoint.id} (${duration}ms)`);
      },
      onCircuitStateChange: (endpoint, oldState, newState) => {
        console.warn(
          `[stellar-rpc] Circuit breaker for ${endpoint.id}: ${oldState} → ${newState}`
        );

        // Alert monitoring system about circuit state changes
        if (newState === "OPEN") {
          console.error(
            `[stellar-rpc] ⚠️ ${endpoint.id} circuit OPENED - failing requests will be rejected`
          );
        } else if (newState === "CLOSED" && oldState === "OPEN") {
          console.log(
            `[stellar-rpc] ✓ ${endpoint.id} circuit CLOSED - normal operation resumed`
          );
        }
      },
    });
  }

  return resilientClient;
}

/**
 * Disposes the resilient client (useful for tests and graceful shutdown).
 */
export function disposeResilientClient(): void {
  if (resilientClient) {
    resilientClient.dispose();
    resilientClient = null;
  }
}

/**
 * Fetches contract events from Soroban RPC with full resilience protection.
 *
 * This is a drop-in replacement for the original fetchContractEvents that adds:
 * - Rate limiting to prevent flooding upstream nodes
 * - Circuit breaker to isolate failing nodes
 * - Automatic fallback to backup nodes
 * - Exponential backoff on repeated failures
 *
 * @param contractIds - Single contract ID or array of contract IDs
 * @param startLedger - Optional starting ledger (defaults to 1000 ledgers ago)
 * @returns Array of contract events
 * @throws {StellarNetworkException} On permanent failures after all retries
 */
export async function fetchContractEventsResilient(
  contractIds: string | string[],
  startLedger?: number
): Promise<RawEvent[]> {
  const client = getResilientClient();
  const ids = Array.isArray(contractIds) ? contractIds : [contractIds];

  try {
    return await client.execute(async (rpcUrl: string) => {
      // Dynamically import stellar-sdk to avoid bundling issues
      const { SorobanRpc } = await import("stellar-sdk");
      const server = new SorobanRpc.Server(rpcUrl);

      // Get latest ledger if startLedger not provided
      let ledgerToFetch = startLedger;
      if (!ledgerToFetch) {
        const latestLedger = await server.getLatestLedger();
        ledgerToFetch = Math.max(1, latestLedger.sequence - 1000);
      }

      console.log(
        `[stellar-rpc] Fetching events for ${ids.length} contract(s) from ${rpcUrl} starting at ledger ${ledgerToFetch}`
      );

      const result = await server.getEvents({
        startLedger: ledgerToFetch,
        filters: [{ type: "contract", contractIds: ids }],
      });

      console.log(`[stellar-rpc] Fetched ${result.events?.length || 0} events`);

      return (result.events || []).map(function (event) {
        const fallbackContractId =
          typeof ids[0] === "string" && ids.length === 1 ? ids[0] : undefined;
        return eventResponseToRawEvent(event, fallbackContractId);
      });
    });
  } catch (error) {
    const contractId = Array.isArray(contractIds) ? contractIds[0] : contractIds;
    const networkError = new StellarNetworkException(
      error instanceof Error ? error.message : "Failed to fetch contract events",
      {
        contractId,
        ledgerSequence: startLedger,
        operation: "fetchContractEventsResilient",
      },
      { cause: error, retriable: false } // Already retried by resilient client
    );
    captureExceptionSync(networkError);
    throw networkError;
  }
}

/**
 * Gets the latest ledger from Soroban RPC with resilience protection.
 *
 * @returns Latest ledger information
 */
export async function getLatestLedgerResilient(): Promise<{
  sequence: number;
  hash: string;
  protocolVersion: number;
}> {
  const client = getResilientClient();

  try {
    return await client.execute(async (rpcUrl: string) => {
      const { SorobanRpc } = await import("stellar-sdk");
      const server = new SorobanRpc.Server(rpcUrl);
      return await server.getLatestLedger();
    });
  } catch (error) {
    const networkError = new StellarNetworkException(
      error instanceof Error ? error.message : "Failed to get latest ledger",
      {
        operation: "getLatestLedgerResilient",
      },
      { cause: error, retriable: false }
    );
    captureExceptionSync(networkError);
    throw networkError;
  }
}

/**
 * Gets current resilience metrics for monitoring and debugging.
 *
 * @returns Comprehensive metrics including rate limiter and circuit breaker states
 */
export function getResilientMetrics() {
  const client = getResilientClient();
  return client.metrics();
}

/**
 * Gets the currently active RPC endpoint.
 * Useful for debugging which node is being used.
 *
 * @returns Current endpoint information
 */
export function getCurrentRpcEndpoint() {
  const client = getResilientClient();
  return client.getCurrentEndpoint();
}

/**
 * Health check for the resilient client.
 * Returns overall system health based on circuit breaker states.
 *
 * @returns Health status
 */
export function getHealthStatus(): {
  healthy: boolean;
  currentEndpoint: string;
  circuitStates: Array<{ endpoint: string; state: string; failures: number }>;
  rateLimiter: {
    availableTokens: number;
    queuedRequests: number;
  };
} {
  const metrics = getResilientMetrics();

  const circuitStates = metrics.circuitBreakers.map((cb) => ({
    endpoint: cb.endpoint.id,
    state: cb.metrics.state,
    failures: cb.metrics.consecutiveFailures,
  }));

  const allCircuitsOpen = circuitStates.every((cs) => cs.state === "OPEN");
  const healthy = !allCircuitsOpen && metrics.rateLimiter.availableTokens > 0;

  return {
    healthy,
    currentEndpoint: metrics.currentEndpoint.id,
    circuitStates,
    rateLimiter: {
      availableTokens: metrics.rateLimiter.availableTokens,
      queuedRequests: metrics.rateLimiter.queuedRequests,
    },
  };
}
