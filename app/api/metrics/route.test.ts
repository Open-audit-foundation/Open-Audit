import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
import { NextRequest } from "next/server";
import { buildOpenApiDocument } from "@/lib/openapi/build-spec";

// Use the same request builder used by the installed Swagger UI.
const swaggerClient: {
  buildRequest(options: {
    spec: ReturnType<typeof buildOpenApiDocument>;
    operationId: string;
    securities: { authorized: Record<string, { value: string }> };
  }): { headers: Record<string, string> };
} = createRequire(import.meta.url)("swagger-client");

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockCount = vi.fn();
const mockFindFirst = vi.fn();

vi.mock("@/lib/db/client", () => ({
  db: {
    deadLetterEvent: { count: (...args: unknown[]) => mockCount(...args) },
    indexerCursor: { findFirst: (...args: unknown[]) => mockFindFirst(...args) },
  },
}));

// Provide a minimal prom-client Registry stand-in so tests don't require
// the real prom-client binary.
vi.mock("@/lib/metrics", () => {
  const mockSet = vi.fn();
  return {
    register: {
      metrics: vi.fn(() => Promise.resolve(MOCK_PROMETHEUS_BODY)),
      contentType: "text/plain; version=0.0.4; charset=utf-8",
    },
    deadLetterQueueSize: { set: mockSet },
    lastIndexedLedger: { set: mockSet },
  };
});

const MOCK_PROMETHEUS_BODY = [
  "# HELP open_audit_translations_total Total number of event translations attempted, labeled by status.",
  "# TYPE open_audit_translations_total counter",
  'open_audit_translations_total{status="translated"} 0',
  "# HELP open_audit_registry_cache_hits_total Number of schema-resolution cache hits.",
  "# TYPE open_audit_registry_cache_hits_total counter",
  "open_audit_registry_cache_hits_total 0",
  "# HELP open_audit_registry_cache_misses_total Number of schema-resolution cache misses.",
  "# TYPE open_audit_registry_cache_misses_total counter",
  "open_audit_registry_cache_misses_total 0",
  "# HELP open_audit_redis_cache_hits_total Number of Redis translation-cache hits.",
  "# TYPE open_audit_redis_cache_hits_total counter",
  "open_audit_redis_cache_hits_total 0",
  "# HELP open_audit_redis_cache_misses_total Number of Redis translation-cache misses.",
  "# TYPE open_audit_redis_cache_misses_total counter",
  "open_audit_redis_cache_misses_total 0",
  "# HELP open_audit_events_ingested_total Total Soroban events ingested from the Stellar network.",
  "# TYPE open_audit_events_ingested_total counter",
  "open_audit_events_ingested_total 0",
  "# HELP open_audit_dead_letter_queue_size Current number of events in the dead-letter queue.",
  "# TYPE open_audit_dead_letter_queue_size gauge",
  "open_audit_dead_letter_queue_size 5",
  "# HELP open_audit_last_indexed_ledger Last Stellar ledger sequence number processed by the indexer.",
  "# TYPE open_audit_last_indexed_ledger gauge",
  "open_audit_last_indexed_ledger 54321000",
  "# HELP open_audit_active_websocket_connections Number of currently active WebSocket connections.",
  "# TYPE open_audit_active_websocket_connections gauge",
  "open_audit_active_websocket_connections 0",
].join("\n");

// ---------------------------------------------------------------------------
// Import under test (after mocks are in place)
// ---------------------------------------------------------------------------

import { GET } from "./route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(authHeader?: string): NextRequest {
  const req = new NextRequest("http://localhost/api/metrics");
  if (authHeader) {
    req.headers.set("authorization", authHeader);
  }
  return req;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("METRICS_TOKEN", "");

  mockCount.mockResolvedValue(5);
  mockFindFirst.mockResolvedValue({ lastLedger: 54321000 });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/metrics", () => {
  it("returns 200 with Prometheus text Content-Type", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/plain.*version=0\.0\.4/);
  });

  it("sets Cache-Control: no-store", async () => {
    const res = await GET(makeRequest());
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("body contains all expected metric family names", async () => {
    const res = await GET(makeRequest());
    const body = await res.text();

    const expectedMetrics = [
      "open_audit_translations_total",
      "open_audit_registry_cache_hits_total",
      "open_audit_registry_cache_misses_total",
      "open_audit_redis_cache_hits_total",
      "open_audit_redis_cache_misses_total",
      "open_audit_events_ingested_total",
      "open_audit_dead_letter_queue_size",
      "open_audit_last_indexed_ledger",
      "open_audit_active_websocket_connections",
    ];

    for (const name of expectedMetrics) {
      expect(body, `missing metric: ${name}`).toContain(name);
    }
  });

  it("returns 401 when METRICS_TOKEN is set and no auth header is provided", async () => {
    process.env.METRICS_TOKEN = "supersecret";
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it("returns 401 when METRICS_TOKEN is set and wrong token is provided", async () => {
    process.env.METRICS_TOKEN = "supersecret";
    const res = await GET(makeRequest("Bearer wrongtoken"));
    expect(res.status).toBe(401);
  });

  it("returns 200 when METRICS_TOKEN is set and correct token is provided", async () => {
    process.env.METRICS_TOKEN = "supersecret";
    const res = await GET(makeRequest("Bearer supersecret"));
    expect(res.status).toBe(200);
  });

  it("lets Swagger send both credentials required by configured metrics", async () => {
    vi.stubEnv("METRICS_TOKEN", "fixture-metrics-token");
    const spec = buildOpenApiDocument();
    const built = swaggerClient.buildRequest({
      spec,
      operationId: "getMetrics",
      securities: {
        authorized: {
          ApiKeyAuth: { value: "fixture-api-key" },
          MetricsBearer: { value: "fixture-metrics-token" },
        },
      },
    });
    const request = new NextRequest("http://localhost/api/metrics", built);

    expect(request.headers.get("x-api-key")).toBe("fixture-api-key");
    expect(request.headers.get("authorization")).toBe("Bearer fixture-metrics-token");
    expect((await GET(request)).status).toBe(200);
    expect(JSON.stringify(spec)).not.toContain("fixture-metrics-token");
  });

  it("does not require a bearer token when the metrics handler has none configured", async () => {
    const spec = buildOpenApiDocument();
    const built = swaggerClient.buildRequest({
      spec,
      operationId: "getMetrics",
      securities: {
        authorized: {
          ApiKeyAuth: { value: "fixture-api-key" },
          MetricsBearer: { value: "unneeded-token" },
        },
      },
    });
    const request = new NextRequest("http://localhost/api/metrics", built);

    expect(request.headers.get("x-api-key")).toBe("fixture-api-key");
    expect(request.headers.has("authorization")).toBe(false);
    expect((await GET(request)).status).toBe(200);
  });

  it("still returns 200 when DB refresh fails (graceful degradation)", async () => {
    mockCount.mockRejectedValueOnce(new Error("DB down"));
    mockFindFirst.mockRejectedValueOnce(new Error("DB down"));

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
  });
});
