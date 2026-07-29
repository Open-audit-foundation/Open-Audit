/**
 * Stellar SDK client configuration.
 *
 * This module sets up the Horizon and Soroban RPC clients
 * for fetching contract events from the Stellar network.
 *
 * Currently uses mock data — replace the fetch functions below
 * with real Stellar SDK calls to connect to the live network.
 */

import { StellarNetworkException } from "../errors";
import { eventResponseToRawEvent } from "./events";
import type { RawEvent } from "../translator/types";

/** Stellar network configuration. */
export interface StellarNetworkConfig {
  horizonUrl: string;
  sorobanRpcUrl: string;
  networkPassphrase: string;
}

export type Network = "testnet" | "mainnet" | "futurenet";

/** Default testnet configuration. */
export const TESTNET_CONFIG: StellarNetworkConfig = {
  horizonUrl:
    process.env.NEXT_PUBLIC_HORIZON_URL ?? "https://horizon-testnet.stellar.org",
  sorobanRpcUrl:
    process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org",
  networkPassphrase:
    process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015",
};

/** Mainnet configuration. */
export const MAINNET_CONFIG: StellarNetworkConfig = {
  horizonUrl: "https://horizon.stellar.org",
  sorobanRpcUrl: "https://mainnet.stellar.validationcloud.io/v1/XGWbaseXCVJaRq0H2NLNR1YoqDmNjjAa",
  networkPassphrase: "Public Global Stellar Network ; September 2015",
};

/** Futurenet is a developer network; mirror of testnet but with different endpoints if available. */
export const FUTURENET_CONFIG: StellarNetworkConfig = {
  horizonUrl: TESTNET_CONFIG.horizonUrl,
  sorobanRpcUrl: TESTNET_CONFIG.sorobanRpcUrl,
  networkPassphrase: TESTNET_CONFIG.networkPassphrase,
};

/**
 * Returns the active network config based on the environment variable.
 */
/**
 * Return config by network id.
 * Defaults to testnet for unknown values.
 */
export function getConfigForNetwork(network: Network | string): StellarNetworkConfig {
  if (network === "mainnet") return MAINNET_CONFIG;
  if (network === "futurenet") return FUTURENET_CONFIG;
  return TESTNET_CONFIG;
}

/** Returns the active network config from `NEXT_PUBLIC_NETWORK` (defaults to testnet). */
export function getNetworkConfig(): StellarNetworkConfig {
  const network = process.env.NEXT_PUBLIC_NETWORK ?? "testnet";
  return getConfigForNetwork(network);
}

/**
 * Fetches recent contract events from Soroban RPC.
 *
 * This is a simple fetch wrapper. For production polling with rate limit
 * handling, use the indexer module (./indexer.ts) which implements
 * exponential backoff retry logic.
 *
 * @param contractIds - Single contract ID or array of contract IDs to fetch events for
 * @param config - Network configuration
 * @param startLedger - Optional starting ledger (defaults to 1000 ledgers ago)
 * @returns Array of contract events
 */
export async function fetchContractEvents(
  contractIds: string | string[],
  config: StellarNetworkConfig = TESTNET_CONFIG,
  startLedger?: number
): Promise<RawEvent[]> {
  try {
    // Dynamically import stellar-sdk to avoid bundling issues
    const { SorobanRpc } = await import("stellar-sdk");

    const server = new SorobanRpc.Server(config.sorobanRpcUrl);

    // Get latest ledger if startLedger not provided
    let ledgerToFetch = startLedger;
    if (!ledgerToFetch) {
      const latestLedger = await server.getLatestLedger();
      ledgerToFetch = Math.max(1, latestLedger.sequence - 1000);
    }

    const ids = Array.isArray(contractIds) ? contractIds : [contractIds];

    console.log(
      `[open-audit] Fetching events for ${ids.length} contract(s) from ${config.sorobanRpcUrl} starting at ledger ${ledgerToFetch}`
    );

    const result = await server.getEvents({
      startLedger: ledgerToFetch,
      filters: [{ type: "contract", contractIds: ids }],
    });

    console.log(`[open-audit] Fetched ${result.events?.length || 0} events`);

    return (result.events || []).map(function (event) {
      const fallbackContractId =
        typeof ids[0] === "string" && ids.length === 1 ? ids[0] : undefined;
      return eventResponseToRawEvent(event, fallbackContractId);
    });
  } catch (error) {
    const contractId = Array.isArray(contractIds) ? contractIds[0] : contractIds;
    const networkError = new StellarNetworkException(
      error instanceof Error ? error.message : "Failed to fetch contract events",
      {
        contractId,
        ledgerSequence: startLedger,
        operation: "fetchContractEvents",
      },
      { cause: error, retriable: true }
    );
    console.error('[client.ts] Error:', networkError);
    throw networkError;
  }
}
