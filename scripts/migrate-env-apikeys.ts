#!/usr/bin/env ts-node
/**
 * Migration script: upserts API keys from the OA_API_KEYS environment variable
 * into the database-backed ApiKey Prisma table.
 *
 * Format of OA_API_KEYS:
 *   Comma-separated entries of "hashedKey:tier:appName"
 *   where appName may contain additional colons.
 *
 *   Example:
 *     OA_API_KEYS="abc123hash:free:my-cool-app,def456hash:partner:enterprise-corp"
 *
 * Usage:
 *   npx ts-node scripts/migrate-env-apikeys.ts
 *   npx tsx scripts/migrate-env-apikeys.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export type DeveloperTier = "free" | "partner";

export interface EnvApiKeyEntry {
  hashedKey: string;
  tier: DeveloperTier;
  appName: string;
}

const VALID_TIERS: DeveloperTier[] = ["free", "partner"];

export function parseEnvApiKeys(raw: string): EnvApiKeyEntry[] {
  if (!raw) return [];

  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const parts = entry.split(":");
      if (parts.length < 3) {
        throw new Error(
          `Invalid OA_API_KEYS entry "${entry}": expected format hashedKey:tier:appName`
        );
      }
      const [hashedKey, tier, ...rest] = parts;
      const appName = rest.join(":") || "unknown";
      if (!hashedKey) {
        throw new Error(`Invalid OA_API_KEYS entry "${entry}": hashedKey is empty`);
      }
      const normalizedTier = (VALID_TIERS as string[]).includes(tier)
        ? (tier as DeveloperTier)
        : "free";
      return { hashedKey, tier: normalizedTier, appName };
    });
}

export async function upsertEnvApiKeys(
  entries: EnvApiKeyEntry[],
  db: PrismaClient = prisma
): Promise<{ upserted: number; skipped: number }> {
  let upserted = 0;
  let skipped = 0;

  for (const entry of entries) {
    try {
      await db.apiKey.upsert({
        where: { hashedKey: entry.hashedKey },
        update: {
          tier: entry.tier,
          appName: entry.appName,
          owner: entry.appName,
          isActive: true,
        },
        create: {
          hashedKey: entry.hashedKey,
          tier: entry.tier,
          appName: entry.appName,
          owner: entry.appName,
          isActive: true,
        },
      });
      upserted++;
    } catch (err) {
      console.error(`[migrate-env-apikeys] Failed to upsert key ${entry.hashedKey.slice(0, 8)}...:`, err);
      skipped++;
    }
  }

  return { upserted, skipped };
}

async function main(): Promise<void> {
  const raw = process.env.OA_API_KEYS ?? "";

  if (!raw) {
    console.log("[migrate-env-apikeys] OA_API_KEYS is empty; nothing to migrate.");
    await prisma.$disconnect();
    return;
  }

  let entries: EnvApiKeyEntry[];
  try {
    entries = parseEnvApiKeys(raw);
  } catch (err) {
    console.error("[migrate-env-apikeys] Parse error:", err instanceof Error ? err.message : err);
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log(`[migrate-env-apikeys] Parsed ${entries.length} key(s) from OA_API_KEYS.`);

  const result = await upsertEnvApiKeys(entries, prisma);

  console.log(
    `[migrate-env-apikeys] Done. Upserted: ${result.upserted}, Skipped: ${result.skipped}.`
  );

  await prisma.$disconnect();
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[migrate-env-apikeys] Fatal error:", err);
    prisma.$disconnect().finally(() => process.exit(1));
  });
}
