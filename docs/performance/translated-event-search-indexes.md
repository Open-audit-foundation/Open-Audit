# Translated event search index profile

This profile documents the database search optimization added in
`migrations/0001_optimize_translated_event_search.sql`.

## What changed

- Added a stored `search_vector` column for generated human-readable event text.
- Added a GIN full-text index on `search_vector`.
- Added composite B-tree indexes for `contract_id, timestamp DESC` and `event_type, timestamp DESC`.
- Added a trigram GIN index for short partial-text fallback searches.

## Reproducing the 1,000,000-row benchmark

Run PostgreSQL locally, then execute:

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/open_audit \
ROWS=1000000 \
./scripts/benchmark-search-indexes.sh | tee docs/performance/local-search-index-profile.txt
```

The script creates a deterministic local seed table with 1,000,000 generated
rows plus selective rows for composite-index probes, records the slow baseline
`ILIKE '%query%'` plan, applies the migration, then records indexed
`EXPLAIN (ANALYZE, BUFFERS)` plans.

## Expected profile shape

Indexed queries should show these plan nodes instead of full-table sequential
scans:

- `Bitmap Index Scan on idx_translated_events_search_vector_gin` for full-text searches.
- `Index Scan using idx_translated_events_contract_timestamp` for contract/time filters.
- `Index Scan using idx_translated_events_event_type_timestamp` for event-type/time filters.

On a typical developer PostgreSQL instance, selective indexed probes should be
below the 50 ms acceptance threshold after the table is warmed and analyzed.
Attach the generated `docs/performance/local-search-index-profile.txt` output to
the pull request when running against the target local hardware.
