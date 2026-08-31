-- Optimize dashboard search over translated Soroban events.
--
-- Expected table: translated_events
-- Required columns used by the dashboard/search API:
--   contract_id text, event_type text, timestamp timestamptz, description text

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE translated_events
  ADD COLUMN IF NOT EXISTS search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(description, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(event_type, '')), 'C')
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_translated_events_search_vector_gin
  ON translated_events USING GIN (search_vector);

CREATE INDEX IF NOT EXISTS idx_translated_events_contract_timestamp
  ON translated_events (contract_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_translated_events_event_type_timestamp
  ON translated_events (event_type, timestamp DESC);

-- Speeds short partial terms that cannot use the tsvector GIN index efficiently.
CREATE INDEX IF NOT EXISTS idx_translated_events_description_trgm
  ON translated_events USING GIN (description gin_trgm_ops);

COMMIT;
