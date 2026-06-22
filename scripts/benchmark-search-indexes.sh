#!/usr/bin/env bash
set -euo pipefail

DATABASE_URL="${DATABASE_URL:-postgres://postgres:postgres@localhost:5432/open_audit}"
ROWS="${ROWS:-1000000}"
QUERY="${QUERY:-transfer whale account}"
CONTRACT_ID="${CONTRACT_ID:-C000000000000000000000000000000000000000042}"
EVENT_TYPE="${EVENT_TYPE:-transfer}"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -v rows="$ROWS" \
  -v query="$QUERY" \
  -v contract_id="$CONTRACT_ID" \
  -v event_type="$EVENT_TYPE" <<'SQL'
\timing on

DROP TABLE IF EXISTS translated_events;
CREATE TABLE translated_events (
  id bigserial PRIMARY KEY,
  contract_id text NOT NULL,
  event_type text NOT NULL,
  timestamp timestamptz NOT NULL,
  description text NOT NULL,
  human_readable text NOT NULL DEFAULT '',
  summary text NOT NULL DEFAULT ''
);

INSERT INTO translated_events (contract_id, event_type, timestamp, description, human_readable, summary)
SELECT
  'C' || lpad((gs % 1000)::text, 60, '0'),
  (ARRAY['transfer', 'mint', 'burn', 'swap'])[1 + (gs % 4)],
  now() - (gs || ' seconds')::interval,
  CASE WHEN gs % 10000 = 42
    THEN 'transfer whale account indexed benchmark row ' || gs
    ELSE 'ordinary translated contract event row ' || gs
  END,
  'human readable event ' || gs,
  'dashboard summary ' || gs
FROM generate_series(1, :rows) AS gs;

-- Guarantee selective composite-index probes exist for the default arguments.
INSERT INTO translated_events (contract_id, event_type, timestamp, description, human_readable, summary)
SELECT :'contract_id', :'event_type', now() - (gs || ' seconds')::interval,
       'transfer whale account benchmark contract row ' || gs,
       'human readable selective benchmark row ' || gs,
       'dashboard selective summary ' || gs
FROM generate_series(1, 1000) AS gs;

ANALYZE translated_events;

\echo '=== Baseline LIKE scan (expected sequential scan) ==='
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, contract_id, event_type, timestamp, description
FROM translated_events
WHERE description ILIKE '%' || :'query' || '%'
ORDER BY timestamp DESC
LIMIT 25;

\i migrations/0001_optimize_translated_event_search.sql
ANALYZE translated_events;

\echo '=== Full-text search (expected GIN bitmap index scan) ==='
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, contract_id, event_type, timestamp, description
FROM translated_events
WHERE search_vector @@ websearch_to_tsquery('simple', :'query')
ORDER BY timestamp DESC
LIMIT 25;

\echo '=== Contract/time filter (expected B-tree index scan) ==='
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, contract_id, event_type, timestamp, description
FROM translated_events
WHERE contract_id = :'contract_id'
ORDER BY timestamp DESC
LIMIT 25;

\echo '=== Event-type/time filter (expected B-tree index scan) ==='
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, contract_id, event_type, timestamp, description
FROM translated_events
WHERE event_type = :'event_type'
ORDER BY timestamp DESC
LIMIT 25;
SQL
