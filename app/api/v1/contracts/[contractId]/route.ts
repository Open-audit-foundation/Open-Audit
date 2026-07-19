import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import {
  getRegistryMetadata,
  hasBlueprint,
} from "@/lib/translator/registry";
import type { ContractRegistryMetadata } from "@/lib/translator/registry";
import { getCached, setCached } from "@/lib/cache/redisCache";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ContractCoverageStats {
  totalEvents: number;
  translatedCount: number;
  crypticCount: number;
  translationRate: number; // 0–1
}

export interface ContractDetailResponse {
  contract: ContractRegistryMetadata;
  coverage: ContractCoverageStats;
  supported: true;
}

export interface ContractNotSupportedResponse {
  contractId: string;
  supported: false;
  message: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const CACHE_NAMESPACE = "open-audit";
const CONTRACT_STATS_PREFIX = `${CACHE_NAMESPACE}:contracts:stats`;
const CACHE_TTL = 60; // seconds

/** Builds the Redis cache key for a contract's coverage stats. */
function statsCacheKey(contractId: string): string {
  return `${CONTRACT_STATS_PREFIX}:${contractId}`;
}

/**
 * Computes live coverage statistics from the Prisma Event table for a
 * single contract. Returns zeroed stats when there are no events yet.
 */
async function computeCoverageStats(
  contractId: string
): Promise<ContractCoverageStats> {
  const groups = await db.event.groupBy({
    by: ["status"],
    where: { contractId },
    _count: { status: true },
  });

  let totalEvents = 0;
  let translatedCount = 0;
  let crypticCount = 0;

  for (const g of groups) {
    totalEvents += g._count.status;
    if (g.status === "translated") translatedCount = g._count.status;
    else if (g.status === "cryptic") crypticCount = g._count.status;
  }

  return {
    totalEvents,
    translatedCount,
    crypticCount,
    translationRate: totalEvents > 0 ? translatedCount / totalEvents : 0,
  };
}

/**
 * Reads coverage stats from Redis cache (60 s TTL) or computes them fresh.
 */
async function getCoverageStats(
  contractId: string
): Promise<ContractCoverageStats> {
  const key = statsCacheKey(contractId);

  const cached = await getCached<ContractCoverageStats>(key);
  if (cached) return cached;

  const stats = await computeCoverageStats(contractId);
  await setCached(key, stats, CACHE_TTL);

  return stats;
}

// ── Route handler ────────────────────────────────────────────────────────────

export async function GET(
  _request: NextRequest,
  { params }: { params: { contractId: string } }
): Promise<
  NextResponse<ContractDetailResponse | ContractNotSupportedResponse>
> {
  const { contractId } = params;

  // Check if this contract is registered in the translation registry.
  if (!hasBlueprint(contractId)) {
    return NextResponse.json(
      {
        contractId,
        supported: false as const,
        message: `Contract "${contractId}" is not registered in the Open-Audit translation registry.`,
      } satisfies ContractNotSupportedResponse,
      { status: 200 }
    );
  }

  // Fetch the registry metadata for this specific contract.
  const contract = getRegistryMetadata().find(
    (m) => m.contractId === contractId
  )!;

  // Fetch live coverage stats (Redis-cached, 60 s TTL).
  const coverage = await getCoverageStats(contractId);

  return NextResponse.json({
    contract,
    coverage,
    supported: true as const,
  });
}
