-- Migration: 0006_historical_ingestion_support
-- Issue #420 — Historical ingestion pipeline (Option B: Postgres-unified)
--
-- Changes
-- ───────
-- 1. Event.source (nullable String)
--    Tags each event as "live" (real-time indexer) or "historical" (backfill).
--    NULL for pre-migration rows; treated as "live" by convention.
--
-- 2. Index on Event.source for fast source-filtered queries.
--
-- 3. IndexerCursor: remove the column default ("current") so any id value is
--    valid.  The application now uses:
--      id = "current"                  → live indexer
--      id = "historical:<contractId>"  → per-contract historical backfill
--      id = "historical:global"        → contract-agnostic historical backfill
--    NOTE: existing rows are unaffected — "current" remains valid.
--
-- 4. Index on IndexerCursor.lastLedger for fast progress lookups.
--
-- All changes are additive / backwards-compatible.

-- 1. Add source column to Event
ALTER TABLE "Event"
  ADD COLUMN IF NOT EXISTS "source" TEXT;

-- 2. Index on Event.source
CREATE INDEX IF NOT EXISTS "Event_source_idx"
  ON "Event" ("source");

-- 3. Drop the column default on IndexerCursor.id
--    (Prisma sets @default("current") in the schema; the DB default is no
--    longer needed now that multiple id values are used.)
ALTER TABLE "IndexerCursor"
  ALTER COLUMN "id" DROP DEFAULT;

-- 4. Index on IndexerCursor.lastLedger
CREATE INDEX IF NOT EXISTS "IndexerCursor_lastLedger_idx"
  ON "IndexerCursor" ("lastLedger");
