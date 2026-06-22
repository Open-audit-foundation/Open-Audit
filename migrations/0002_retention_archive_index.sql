-- Migration: 0002_retention_archive_index
--
-- Adds a partial index on Event.createdAt to make the retention archiver's
-- eligibility query (WHERE createdAt < :cutoff) fast even on large tables.
-- Also creates the ArchiveLog table to record every archive run for audit
-- and observability purposes.
--
-- Safe to run against a live database; both operations are non-blocking
-- on PostgreSQL 15+ (CREATE INDEX CONCURRENTLY, CREATE TABLE IF NOT EXISTS).

BEGIN;

-- ── 1. Performance index on Event.createdAt ────────────────────────────────

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_event_created_at
  ON "Event" (created_at ASC);

-- ── 2. Archive run log table ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "ArchiveLog" (
  id              TEXT        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  -- ISO cutoff date used for this run
  cutoff_date     TIMESTAMPTZ NOT NULL,
  -- Number of rows written to the archive file
  rows_archived   INTEGER     NOT NULL DEFAULT 0,
  -- Number of rows deleted from Event (should equal rows_archived on success)
  rows_deleted    INTEGER     NOT NULL DEFAULT 0,
  -- Absolute path of the produced .csv.gz file (empty on failure / no data)
  archive_file    TEXT        NOT NULL DEFAULT '',
  -- Wall-clock duration in milliseconds
  duration_ms     INTEGER     NOT NULL DEFAULT 0,
  -- "success" | "failed" | "skipped"
  status          TEXT        NOT NULL DEFAULT 'success',
  -- Error message populated on failure
  error_message   TEXT,
  -- "cron" | "manual"
  triggered_by    TEXT        NOT NULL DEFAULT 'cron',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_archive_log_created_at
  ON "ArchiveLog" (created_at DESC);

COMMIT;
