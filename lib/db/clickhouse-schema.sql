-- ============================================================
-- Open-Audit  –  ClickHouse DDL
-- Run once against the `open_audit` database.
-- ============================================================

-- ----------------------------------------------------------------
-- 1. Main events table
--    MergeTree engine: columnar storage, ordered by (contract_id,
--    ledger) so range scans per contract are fast.
--    ReplacingMergeTree deduplicates rows with the same event_id
--    in the background (eventual uniqueness – mirrors upsert).
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events
(
    event_id        String,
    contract_id     LowCardinality(String),
    ledger          UInt32,
    event_timestamp DateTime CODEC(Delta, ZSTD),
    tx_hash         String,
    topics          String,   -- JSON array serialised as string
    data            String,
    description     Nullable(String),
    status          LowCardinality(String),
    blueprint_name  Nullable(String),
    event_type      LowCardinality(String),
    rpc_verified    UInt8     DEFAULT 0,
    created_at      DateTime  DEFAULT now()
)
ENGINE = ReplacingMergeTree(created_at)
PARTITION BY toYYYYMM(event_timestamp)
ORDER BY (contract_id, ledger, event_id)
SETTINGS index_granularity = 8192;

-- ----------------------------------------------------------------
-- 2. Indexer-cursor table  (single-row, tracks polling progress)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS indexer_cursor
(
    id            String DEFAULT 'current',
    last_ledger   UInt32,
    last_processed DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(last_processed)
ORDER BY id;

-- ----------------------------------------------------------------
-- 3. Materialized View – daily transaction volume per contract
--    Pre-aggregates counts & distinct-tx so the API can answer
--    "last N days of activity" in < 50 ms even at billion-row scale.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mv_daily_contract_volume_state
(
    contract_id  LowCardinality(String),
    event_date   Date,
    event_count  AggregateFunction(count),
    unique_tx    AggregateFunction(uniq, String)
)
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(event_date)
ORDER BY (contract_id, event_date);

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_daily_contract_volume
TO mv_daily_contract_volume_state
AS
SELECT
    contract_id,
    toDate(event_timestamp)               AS event_date,
    countState()                          AS event_count,
    uniqState(tx_hash)                    AS unique_tx
FROM events
GROUP BY contract_id, event_date;

-- ----------------------------------------------------------------
-- 4. Materialized View – rolling event-type breakdown
--    Feeds the analytics summary cards in the dashboard.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mv_event_type_totals_state
(
    contract_id  LowCardinality(String),
    event_type   LowCardinality(String),
    total        AggregateFunction(count)
)
ENGINE = AggregatingMergeTree()
ORDER BY (contract_id, event_type);

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_event_type_totals
TO mv_event_type_totals_state
AS
SELECT
    contract_id,
    event_type,
    countState() AS total
FROM events
GROUP BY contract_id, event_type;
