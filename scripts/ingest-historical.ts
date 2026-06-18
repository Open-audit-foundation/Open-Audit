#!/usr/bin/env ts-node
/**
 * Historical Ledger Range Ingestion CLI
 *
 * Usage:
 *   npx ts-node scripts/ingest-historical.ts <contractId> <startSequence> <endSequence> [options]
 *
 * Examples:
 *   npx ts-node scripts/ingest-historical.ts CABC123... 1000 5000
 *   npx ts-node scripts/ingest-historical.ts CABC123... 1000 5000 --chunk-size 500
 *   npx ts-node scripts/ingest-historical.ts CABC123... 1000 5000 --network mainnet
 */

import * as fs from "fs";
import * as path from "path";
import { ingestHistoricalRange } from "../lib/stellar/historical-ingester";
import { getNetworkConfig, type StellarNetworkConfig } from "../lib/stellar/client";

interface ParsedArgs {
  contractId: string;
  startSequence: number;
  endSequence: number;
  chunkSize: number;
  network: string;
  outputFile?: string;
}

/**
 * Parse command line arguments.
 */
function parseArgs(args: string[]): ParsedArgs {
  if (args.length < 3) {
    printUsage();
    process.exit(1);
  }

  const [contractId, startSeqStr, endSeqStr, ...flags] = args;

  const startSequence = parseInt(startSeqStr, 10);
  const endSequence = parseInt(endSeqStr, 10);

  if (isNaN(startSequence) || isNaN(endSequence)) {
    console.error("Error: startSequence and endSequence must be valid integers");
    process.exit(1);
  }

  let chunkSize = 1000;
  let network = "testnet";
  let outputFile: string | undefined;

  // Parse flags
  for (let i = 0; i < flags.length; i += 2) {
    const flag = flags[i];
    const value = flags[i + 1];

    switch (flag) {
      case "--chunk-size":
        chunkSize = parseInt(value, 10);
        if (isNaN(chunkSize) || chunkSize < 1) {
          console.error("Error: chunk-size must be a positive integer");
          process.exit(1);
        }
        break;
      case "--network":
        network = value;
        break;
      case "--output":
        outputFile = value;
        break;
    }
  }

  return {
    contractId,
    startSequence,
    endSequence,
    chunkSize,
    network,
    outputFile,
  };
}

/**
 * Print usage information.
 */
function printUsage(): void {
  console.log(`
Historical Ledger Range Ingestion CLI

Usage:
  npx ts-node scripts/ingest-historical.ts <contractId> <startSequence> <endSequence> [options]

Arguments:
  contractId       Contract ID to fetch events for
  startSequence    Starting ledger sequence number
  endSequence      Ending ledger sequence number (inclusive)

Options:
  --chunk-size N   Number of ledgers per chunk (default: 1000)
  --network        Network to use: testnet or mainnet (default: testnet)
  --output FILE    Optional file to save events JSON to

Examples:
  npx ts-node scripts/ingest-historical.ts CABC123... 1000 5000
  npx ts-node scripts/ingest-historical.ts CABC123... 1000 5000 --chunk-size 500
  npx ts-node scripts/ingest-historical.ts CABC123... 1000 5000 --network mainnet --output events.json
`);
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  console.log(`\n[CLI] Starting historical ingestion...`);
  console.log(`[CLI] Contract ID: ${args.contractId}`);
  console.log(`[CLI] Range: ${args.startSequence} - ${args.endSequence}`);
  console.log(`[CLI] Chunk Size: ${args.chunkSize}`);
  console.log(`[CLI] Network: ${args.network}\n`);

  // Get network config
  const networkConfig =
    args.network === "mainnet"
      ? {
          horizonUrl: "https://horizon.stellar.org",
          sorobanRpcUrl: "https://mainnet.stellar.validationcloud.io/v1/XGWbaseXCVJaRq0H2NLNR1YoqDmNjjAa",
          networkPassphrase: "Public Global Stellar Network ; September 2015",
        }
      : getNetworkConfig();

  const events: unknown[] = [];
  const startTime = Date.now();

  try {
    await ingestHistoricalRange({
      networkConfig,
      contractId: args.contractId,
      startSequence: args.startSequence,
      endSequence: args.endSequence,
      chunkSize: args.chunkSize,
      onChunkComplete: async (result) => {
        events.push(...result.events);
        console.log(
          `✓ Chunk ${result.chunkIndex + 1}: ${result.eventCount} events (${result.startSequence}-${result.endSequence})`
        );
      },
      onComplete: async (totalEvents, totalChunks) => {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`\n✓ Completed! Fetched ${totalEvents} events in ${totalChunks} chunks (${elapsed}s)`);

        // Save to file if requested
        if (args.outputFile) {
          const outputPath = path.resolve(args.outputFile);
          fs.writeFileSync(outputPath, JSON.stringify(events, null, 2));
          console.log(`✓ Events saved to ${outputPath}`);
        }
      },
      onError: (error, chunkIndex) => {
        console.error(`✗ Error in chunk ${chunkIndex}: ${error.message}`);
      },
    });
  } catch (error) {
    console.error(`\n✗ Ingestion failed:`, error);
    process.exit(1);
  }
}

// Run main
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
