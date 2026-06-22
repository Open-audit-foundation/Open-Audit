import { createClient, type ClickHouseClient } from "@clickhouse/client";

let _client: ClickHouseClient | null = null;

export function getClickHouseClient(): ClickHouseClient {
  if (!_client) {
    _client = createClient({
      url: process.env.CLICKHOUSE_URL ?? "http://localhost:8123",
      username: process.env.CLICKHOUSE_USER ?? "default",
      password: process.env.CLICKHOUSE_PASSWORD ?? "",
      database: process.env.CLICKHOUSE_DB ?? "open_audit",
      clickhouse_settings: {
        // Allow async inserts so each call returns immediately; rows are flushed
        // by ClickHouse in the background (reduces round-trips).
        async_insert: 1,
        wait_for_async_insert: 0,
      },
    });
  }
  return _client;
}
