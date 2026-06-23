#!/usr/bin/env node
/**
 * EVM Bridge Indexer Worker
 *
 * Lightweight secondary ingestion worker that listens to Ethereum (and L2)
 * RPC nodes for bridge Mint events, then hands them to the cross-chain matcher.
 *
 * Event signatures tracked (ERC-20 style bridge contracts):
 *   BurnInitiated(address indexed token, address indexed sender,
 *                 address indexed recipient, uint256 amount,
 *                 bytes32 destinationProof)
 *
 *   MintCompleted(address indexed token, address indexed recipient,
 *                 uint256 amount, bytes32 sourceProof)
 *
 * The worker polls eth_getLogs every POLL_INTERVAL_MS milliseconds and
 * maintains a cursor (lastBlock) in Redis so it survives restarts.
 *
 * Run with:
 *   ts-node --project tsconfig.server.json src/worker/evm-bridge-indexer.ts
 */

import Redis from "ioredis";
import { db } from "../../lib/db/client";
import { matchBridgeEvent, expireUnmatchedBurns } from "../../lib/bridge/matcher";
import type { RawBridgeEvent, BridgeChain, EvmLog } from "../../lib/bridge/types";

// ============================================================================
// Configuration
// ============================================================================

const WORKER_ID = process.env.EVM_WORKER_ID ?? `evm-worker-${process.pid}`;
const REDIS_URL  = process.env.REDIS_URL ?? "redis://localhost:6379";
const REDIS_CHANNEL = process.env.REDIS_BRIDGE_CHANNEL ?? "bridge:events";

// RPC endpoints — comma-separated for multiple networks
// e.g. "ethereum:https://eth-mainnet.g.alchemy.com/v2/KEY,optimism:https://opt-mainnet.g.alchemy.com/v2/KEY"
const EVM_RPC_ENDPOINTS_RAW = process.env.EVM_RPC_ENDPOINTS ?? "";

// Bridge contract addresses to watch — comma-separated, chain-prefixed
// e.g. "ethereum:0xAbCd...,optimism:0xEfGh..."
const BRIDGE_CONTRACT_ADDRESSES_RAW = process.env.BRIDGE_CONTRACT_ADDRESSES ?? "";

const POLL_INTERVAL_MS = parseInt(process.env.EVM_POLL_INTERVAL_MS ?? "12000", 10); // ~1 Ethereum block
const MAX_BLOCK_RANGE  = parseInt(process.env.EVM_MAX_BLOCK_RANGE ?? "500", 10);
const EXPIRE_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// ============================================================================
// Keccak256 topic hashes for the bridge events we care about
// (pre-computed — avoids ethers/viem dependency for a lightweight worker)
// ============================================================================
const TOPIC_BURN_INITIATED  = "0x7dc80be7817baa293a2a2f8154e572c9da84c52c3c5c0bba69e29c1eecc1c2c5";
const TOPIC_MINT_COMPLETED  = "0x4d99da7b5b3c7d6c2d3e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2";

// ============================================================================
// EVM RPC helpers (minimal, no ethers/viem required)
// ============================================================================

interface RpcEndpoint {
  chain: BridgeChain;
  url: string;
}

interface ContractFilter {
  chain: BridgeChain;
  address: string;
}

function parseRpcEndpoints(raw: string): RpcEndpoint[] {
  if (!raw.trim()) return [];
  return raw.split(",").flatMap((entry) => {
    const [chain, url] = entry.trim().split(":", 2);
    if (!chain || !url) return [];
    return [{ chain: chain.trim() as BridgeChain, url: url.trim() }];
  });
}

function parseContractFilters(raw: string): ContractFilter[] {
  if (!raw.trim()) return [];
  return raw.split(",").flatMap((entry) => {
    const [chain, address] = entry.trim().split(":", 2);
    if (!chain || !address) return [];
    return [{ chain: chain.trim() as BridgeChain, address: address.trim().toLowerCase() }];
  });
}

async function jsonRpc(
  url: string,
  method: string,
  params: unknown[]
): Promise<unknown> {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!resp.ok) {
    throw new Error(`RPC ${method} failed: ${resp.status} ${resp.statusText}`);
  }
  const json = (await resp.json()) as { result?: unknown; error?: { message: string } };
  if (json.error) throw new Error(`RPC error: ${json.error.message}`);
  return json.result;
}

async function getLatestBlock(url: string): Promise<bigint> {
  const hex = (await jsonRpc(url, "eth_blockNumber", [])) as string;
  return BigInt(hex);
}

async function getLogs(
  url: string,
  addresses: string[],
  topics: string[],
  fromBlock: bigint,
  toBlock: bigint
): Promise<EvmLog[]> {
  const result = await jsonRpc(url, "eth_getLogs", [
    {
      address: addresses,
      topics: [topics],
      fromBlock: "0x" + fromBlock.toString(16),
      toBlock: "0x" + toBlock.toString(16),
    },
  ]);
  return result as EvmLog[];
}

// ============================================================================
// Log → RawBridgeEvent parsing
// ============================================================================

function parseEvmLog(log: EvmLog, chain: BridgeChain): RawBridgeEvent | null {
  const topic0 = log.topics[0]?.toLowerCase();

  if (topic0 === TOPIC_BURN_INITIATED) {
    // topics: [sig, token, sender, recipient]   data: [amount, destinationProof]
    return {
      chain,
      eventType: "burn",
      txHash: log.transactionHash,
      blockNumber: BigInt(log.blockNumber),
      timestamp: 0, // populated below via eth_getBlockByNumber
      contractAddress: log.address.toLowerCase(),
      token: log.topics[1] ? "0x" + log.topics[1].slice(26) : undefined,
      sender: log.topics[2] ? "0x" + log.topics[2].slice(26) : undefined,
      recipient: log.topics[3] ? "0x" + log.topics[3].slice(26) : undefined,
      amount: BigInt("0x" + log.data.slice(2, 66)).toString(),
      destinationProof: log.data.length >= 130 ? "0x" + log.data.slice(66, 130) : undefined,
      rawPayload: log,
    };
  }

  if (topic0 === TOPIC_MINT_COMPLETED) {
    // topics: [sig, token, recipient]   data: [amount, sourceProof]
    return {
      chain,
      eventType: "mint",
      txHash: log.transactionHash,
      blockNumber: BigInt(log.blockNumber),
      timestamp: 0,
      contractAddress: log.address.toLowerCase(),
      token: log.topics[1] ? "0x" + log.topics[1].slice(26) : undefined,
      recipient: log.topics[2] ? "0x" + log.topics[2].slice(26) : undefined,
      amount: BigInt("0x" + log.data.slice(2, 66)).toString(),
      destinationProof: log.data.length >= 130 ? "0x" + log.data.slice(66, 130) : undefined,
      rawPayload: log,
    };
  }

  return null;
}

// ============================================================================
// Redis cursor management
// ============================================================================

class CursorStore {
  constructor(private redis: Redis) {}

  key(chain: BridgeChain): string {
    return `bridge:cursor:${chain}`;
  }

  async get(chain: BridgeChain): Promise<bigint | null> {
    const val = await this.redis.get(this.key(chain));
    return val ? BigInt(val) : null;
  }

  async set(chain: BridgeChain, block: bigint): Promise<void> {
    await this.redis.set(this.key(chain), block.toString());
  }
}

// ============================================================================
// Redis publisher (reuses the same pattern from src/worker/indexer.ts)
// ============================================================================

class BridgeEventPublisher {
  private client: Redis;

  constructor(url: string) {
    this.client = new Redis(url, {
      retryStrategy: (t) => Math.min(t * 1000, 10000),
      enableReadyCheck: true,
      maxRetriesPerRequest: 3,
    });
    this.client.on("error", (e) =>
      console.error(`[${WORKER_ID}] Redis error:`, e.message)
    );
  }

  async publish(event: RawBridgeEvent): Promise<void> {
    await this.client.publish(REDIS_CHANNEL, JSON.stringify(event));
  }

  subscriber(): Redis {
    return this.client.duplicate();
  }
}

// ============================================================================
// Per-chain polling loop
// ============================================================================

async function pollChain(
  endpoint: RpcEndpoint,
  contracts: ContractFilter[],
  cursors: CursorStore,
  publisher: BridgeEventPublisher
): Promise<void> {
  const { chain, url } = endpoint;
  const chainContracts = contracts
    .filter((c) => c.chain === chain)
    .map((c) => c.address);

  if (chainContracts.length === 0) {
    console.log(`[${WORKER_ID}] No contracts configured for ${chain}, skipping`);
    return;
  }

  const topics = [TOPIC_BURN_INITIATED, TOPIC_MINT_COMPLETED];

  // Determine starting block
  let fromBlock = await cursors.get(chain);
  if (!fromBlock) {
    const latest = await getLatestBlock(url);
    // Start 1000 blocks back on first run (roughly covers last ~3h on Ethereum)
    fromBlock = latest - 1000n > 0n ? latest - 1000n : 0n;
  }

  const latestBlock = await getLatestBlock(url);
  const toBlock = fromBlock + BigInt(MAX_BLOCK_RANGE) < latestBlock
    ? fromBlock + BigInt(MAX_BLOCK_RANGE)
    : latestBlock;

  if (fromBlock >= latestBlock) {
    // Nothing new yet
    return;
  }

  console.log(
    `[${WORKER_ID}] [${chain}] Scanning blocks ${fromBlock}–${toBlock} (${chainContracts.length} contract(s))`
  );

  const logs = await getLogs(url, chainContracts, topics, fromBlock, toBlock);

  let processed = 0;
  for (const log of logs) {
    const event = parseEvmLog(log, chain);
    if (!event) continue;

    // Fetch block timestamp (we cache in rawPayload to avoid extra RPCs)
    if (event.timestamp === 0) {
      try {
        const block = (await jsonRpc(url, "eth_getBlockByNumber", [
          log.blockNumber,
          false,
        ])) as { timestamp: string } | null;
        event.timestamp = block ? parseInt(block.timestamp, 16) : Math.floor(Date.now() / 1000);
      } catch {
        event.timestamp = Math.floor(Date.now() / 1000);
      }
    }

    // Persist to DB
    const persisted = await db.bridgeEvent.create({
      data: {
        chain: event.chain,
        eventType: event.eventType,
        txHash: event.txHash,
        blockNumber: event.blockNumber,
        timestamp: event.timestamp,
        contractAddress: event.contractAddress,
        sender: event.sender ?? null,
        recipient: event.recipient ?? null,
        token: event.token ?? null,
        amount: event.amount,
        destinationChain: event.destinationChain ?? null,
        destinationProof: event.destinationProof ?? null,
        rawPayload: event.rawPayload,
      },
    });

    // Try to match against the opposite chain's events
    const matchResult = await matchBridgeEvent(event, persisted.id);

    // Publish on Redis so the web server can push to dashboard clients
    await publisher.publish({
      ...event,
      rawPayload: {
        ...event.rawPayload,
        _matchId: matchResult.matchId ?? null,
        _confidence: matchResult.confidence ?? null,
      },
    });

    processed++;
  }

  if (processed > 0) {
    console.log(`[${WORKER_ID}] [${chain}] Processed ${processed} bridge event(s)`);
  }

  // Advance cursor
  await cursors.set(chain, toBlock + 1n);
}

// ============================================================================
// Main entry point
// ============================================================================

async function main(): Promise<void> {
  console.log(`[${WORKER_ID}] EVM Bridge Indexer starting…`);

  const endpoints = parseRpcEndpoints(EVM_RPC_ENDPOINTS_RAW);
  const contracts  = parseContractFilters(BRIDGE_CONTRACT_ADDRESSES_RAW);

  if (endpoints.length === 0) {
    console.warn(
      `[${WORKER_ID}] EVM_RPC_ENDPOINTS not set — worker is idle. ` +
      `Set EVM_RPC_ENDPOINTS=ethereum:https://...,optimism:https://... to activate.`
    );
  }

  const publisher = new BridgeEventPublisher(REDIS_URL);
  const redisForCursors = new Redis(REDIS_URL, {
    retryStrategy: (t) => Math.min(t * 1000, 10000),
    enableReadyCheck: true,
    maxRetriesPerRequest: 3,
  });
  const cursors = new CursorStore(redisForCursors);

  // Graceful shutdown
  let running = true;
  for (const sig of ["SIGTERM", "SIGINT"] as NodeJS.Signals[]) {
    process.on(sig, () => {
      console.log(`[${WORKER_ID}] Received ${sig}, shutting down…`);
      running = false;
    });
  }

  // Periodic expiry check for unmatched burns
  let lastExpireCheck = 0;

  // Main polling loop
  while (running) {
    try {
      // Poll each configured chain in parallel
      await Promise.all(
        endpoints.map((ep) => pollChain(ep, contracts, cursors, publisher))
      );

      // Expire stale unmatched burns periodically
      const now = Date.now();
      if (now - lastExpireCheck > EXPIRE_CHECK_INTERVAL_MS) {
        const expired = await expireUnmatchedBurns();
        if (expired > 0) {
          console.log(`[${WORKER_ID}] Marked ${expired} burn(s) as unmatched (timeout)`);
        }
        lastExpireCheck = now;
      }
    } catch (err) {
      console.error(`[${WORKER_ID}] Poll error:`, err);
    }

    if (running) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  }

  redisForCursors.disconnect();
  console.log(`[${WORKER_ID}] EVM Bridge Indexer stopped.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(`[${WORKER_ID}] Fatal error:`, err);
  process.exit(1);
});
