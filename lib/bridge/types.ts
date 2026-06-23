/**
 * Cross-chain bridge tracking types.
 *
 * A "bridge transfer" always starts with a Burn on Stellar/Soroban and
 * ends with a Mint on an EVM-compatible chain (Ethereum, OP, Arbitrum, Base).
 */

export type BridgeChain =
  | "stellar"
  | "ethereum"
  | "optimism"
  | "arbitrum"
  | "base";

export type BridgeEventType = "burn" | "mint";

export type MatchStatus =
  | "pending"   // burn seen, waiting for EVM mint
  | "matched"   // both sides confirmed
  | "unmatched" // burn timed out without a mint
  | "disputed"; // amount or recipient mismatch

export type MatchMethod =
  | "proof"              // destinationProof / nonce matched exactly
  | "amount+timestamp"   // same amount within ±10 minutes
  | "amount+recipient";  // same amount + recipient, wider window

/** A raw bridge event from either chain before persistence. */
export interface RawBridgeEvent {
  chain: BridgeChain;
  eventType: BridgeEventType;
  txHash: string;
  blockNumber: bigint;
  timestamp: number; // Unix seconds
  contractAddress: string;
  sender?: string;
  recipient?: string;
  token?: string;
  /** String so it works with amounts larger than Number.MAX_SAFE_INTEGER */
  amount: string;
  destinationChain?: string;
  /** On-chain nonce / messageId that uniquely links the burn to its mint */
  destinationProof?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rawPayload: Record<string, any>;
}

/** Fully resolved cross-chain match returned to the UI. */
export interface CrossChainJourney {
  id: string;
  status: MatchStatus;
  burnChain: BridgeChain;
  mintChain: BridgeChain;
  burnTxHash: string;
  mintTxHash: string | null;
  token: string | null;
  amount: string;
  sender: string | null;
  recipient: string | null;
  burnTimestamp: number;
  mintTimestamp: number | null;
  latencySeconds: number | null;
  destinationProof: string | null;
  matchConfidence: number;
  matchMethod: MatchMethod | null;
  events: RawBridgeEvent[];
  createdAt: string;
}

/** EVM RPC log as returned by eth_getLogs */
export interface EvmLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;       // hex
  transactionHash: string;
  transactionIndex: string;  // hex
  blockHash: string;
  logIndex: string;          // hex
  removed: boolean;
}
