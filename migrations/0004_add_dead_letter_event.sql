-- Migration: 0004_add_dead_letter_event
-- Adds the DeadLetterEvent table for unparseable Soroban events.

BEGIN;

CREATE TABLE IF NOT EXISTS "DeadLetterEvent" (
  id            TEXT        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  event_id      TEXT        NOT NULL,
  contract_id   TEXT        NOT NULL,
  ledger        INTEGER     NOT NULL,
  timestamp     INTEGER     NOT NULL,
  tx_hash       TEXT        NOT NULL,
  topics        JSONB       NOT NULL,
  data          TEXT        NOT NULL,
  error_code    TEXT        NOT NULL,
  error_message TEXT        NOT NULL,
  error_stack   TEXT,
  error_context JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dead_letter_event_contract_id
  ON "DeadLetterEvent" (contract_id);

CREATE INDEX IF NOT EXISTS idx_dead_letter_event_event_id
  ON "DeadLetterEvent" (event_id);

CREATE INDEX IF NOT EXISTS idx_dead_letter_event_created_at
  ON "DeadLetterEvent" (created_at DESC);

COMMIT;
