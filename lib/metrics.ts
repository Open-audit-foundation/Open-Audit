/**
 * Prometheus metrics registry for Open-Audit.
 *
 * Exports a named Registry plus all metric instances.
 * Import the individual counters/gauges from here to instrument code;
 * import `register` in the /api/metrics route to serve the scrape endpoint.
 *
 * NOTE: prom-client registers metrics globally by default. We use a dedicated
 * Registry to avoid conflicts if prom-client's default registry is used
 * elsewhere (e.g. in tests with collectDefaultMetrics).
 */

// Import directly from prom-client's submodules rather than the package root.
// The root barrel (`prom-client`) unconditionally requires `./lib/defaultMetrics`
// and `./lib/cluster`, which use Node-only built-ins (`fs`, `v8`, `cluster`).
// This module is imported from isomorphic code (lib/translator/registry.ts is
// used client-side by the sandbox page, and lib/cache/redisCache.ts is
// imported by the Edge middleware), so pulling in the barrel breaks both the
// Edge and browser bundles. The Counter/Gauge/Registry submodules have no such
// dependency, so importing them directly keeps this module bundleable everywhere
// while still recording real metrics in the Node.js server process.
import Counter from "prom-client/lib/counter";
import Gauge from "prom-client/lib/gauge";
import Registry from "prom-client/lib/registry";

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const register = new Registry();
register.setDefaultLabels({ service: "open-audit" });

// ---------------------------------------------------------------------------
// Counters
// ---------------------------------------------------------------------------

/** Total translation attempts, labeled by outcome status ("translated" | "cryptic"). */
export const translationsTotal = new Counter({
  name: "open_audit_translations_total",
  help: "Total number of event translations attempted, labeled by status.",
  labelNames: ["status"] as const,
  registers: [register],
});

/**
 * Registry (schema) resolution cache hits and misses.
 * label: result = "hit" | "miss"
 */
export const registryCacheHitsTotal = new Counter({
  name: "open_audit_registry_cache_hits_total",
  help: "Number of schema-resolution cache hits.",
  registers: [register],
});

export const registryCacheMissesTotal = new Counter({
  name: "open_audit_registry_cache_misses_total",
  help: "Number of schema-resolution cache misses.",
  registers: [register],
});

/**
 * Redis translation-cache hits and misses.
 * Incremented in lib/cache/redisCache when getCachedTranslation is called.
 */
export const redisCacheHitsTotal = new Counter({
  name: "open_audit_redis_cache_hits_total",
  help: "Number of Redis translation-cache hits.",
  registers: [register],
});

export const redisCacheMissesTotal = new Counter({
  name: "open_audit_redis_cache_misses_total",
  help: "Number of Redis translation-cache misses.",
  registers: [register],
});

/** Total raw Soroban events ingested from the Stellar network. */
export const eventsIngestedTotal = new Counter({
  name: "open_audit_events_ingested_total",
  help: "Total Soroban events ingested from the Stellar network.",
  labelNames: ["status"] as const,
  registers: [register],
});

// ---------------------------------------------------------------------------
// Gauges
// ---------------------------------------------------------------------------

/** Current number of events sitting in the Dead Letter Queue. */
export const deadLetterQueueSize = new Gauge({
  name: "open_audit_dead_letter_queue_size",
  help: "Current number of events in the dead-letter queue.",
  registers: [register],
});

/** Last ledger sequence number successfully indexed. */
export const lastIndexedLedger = new Gauge({
  name: "open_audit_last_indexed_ledger",
  help: "Last Stellar ledger sequence number processed by the indexer.",
  registers: [register],
});

/** Number of active WebSocket client connections. */
export const activeWebSocketConnections = new Gauge({
  name: "open_audit_active_websocket_connections",
  help: "Number of currently active WebSocket connections.",
  registers: [register],
});
