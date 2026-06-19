import type { SorobanRpc } from "stellar-sdk";
import type { RawEvent } from "../translator/types";

type RpcEventLike = Partial<SorobanRpc.Api.EventResponse> & {
  contractId?: string;
  contract_id?: string;
  pagingToken?: string;
  ledger?: number | string;
  ledgerClosedAt?: string;
  timestamp?: number;
  topic?: unknown[];
  topics?: unknown[];
  value?: unknown;
  data?: unknown;
  txHash?: string;
  transactionHash?: string;
};

/**
 * Converts a Soroban RPC event into Open-Audit's RawEvent shape.
 * Soroban exposes event topics as an ordered vector, and every element matters.
 */
export function eventResponseToRawEvent(
  event: SorobanRpc.Api.EventResponse,
  fallbackContractId?: string
): RawEvent {
  const source = event as RpcEventLike;
  const ledger = toNumber(source.ledger, 0);

  return {
    id: String(source.id ?? source.pagingToken ?? `${ledger}-0`),
    contractId: source.contractId ?? source.contract_id ?? fallbackContractId ?? "unknown",
    topics: normalizeTopics(source.topics ?? source.topic),
    data: normalizeScVal(source.data ?? source.value),
    ledger,
    timestamp: normalizeTimestamp(source.timestamp, source.ledgerClosedAt),
    txHash: source.txHash ?? source.transactionHash ?? "",
  };
}

/** Normalizes the full ordered topic vector without dropping secondary topics. */
export function normalizeTopics(topics: unknown): string[] {
  if (!Array.isArray(topics)) return [];
  return topics.map(normalizeScVal);
}

function normalizeScVal(value: unknown): string {
  if (typeof value === "string") return value;

  if (value && typeof value === "object" && "toXDR" in value) {
    const xdrValue = value as { toXDR: (encoding: "hex" | "base64") => string };
    return `0x${xdrValue.toXDR("hex")}`;
  }

  if (value === null || value === undefined) return "";
  return String(value);
}

function normalizeTimestamp(timestamp: unknown, ledgerClosedAt: unknown): number {
  const explicit = toNumber(timestamp, NaN);
  if (Number.isFinite(explicit)) return explicit;

  if (typeof ledgerClosedAt === "string") {
    const parsed = Date.parse(ledgerClosedAt);
    if (Number.isFinite(parsed)) return Math.floor(parsed / 1000);
  }

  return Math.floor(Date.now() / 1000);
}

function toNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}
