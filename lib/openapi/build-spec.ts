import type { HttpMethod, OperationDoc, RegistryEntry } from "./types";
import { HTTP_METHODS, isMethodMap } from "./types";
import { componentSchemas } from "./schemas";
import { routeRegistry } from "./registry";

export type OpenApiDocument = {
  openapi: "3.0.3";
  info: {
    title: string;
    version: string;
    description: string;
  };
  servers: Array<{ url: string; description?: string }>;
  tags: Array<{ name: string; description?: string }>;
  paths: Record<string, Record<string, unknown>>;
  components: {
    securitySchemes: Record<string, Record<string, unknown>>;
    schemas: Record<string, unknown>;
  };
  security: Array<Record<string, string[]>>;
};

function expandEntry(
  entry: RegistryEntry
): Array<{ path: string; method: HttpMethod; operation: OperationDoc }> {
  const { path, doc } = entry;
  if (isMethodMap(doc)) {
    const out: Array<{ path: string; method: HttpMethod; operation: OperationDoc }> = [];
    for (const method of HTTP_METHODS) {
      const operation = doc[method];
      if (operation) out.push({ path, method, operation });
    }
    if (out.length === 0) {
      throw new Error(`routeDoc for ${path} has no HTTP method operations`);
    }
    return out;
  }
  if (!entry.method) {
    throw new Error(
      `Flat routeDoc for ${path} requires a registry 'method' field (ingest-historical pattern)`
    );
  }
  return [{ path, method: entry.method, operation: doc }];
}

/**
 * Assemble a valid OpenAPI 3.0 document from every registered routeDoc.
 */
export function buildOpenApiDocument(entries: RegistryEntry[] = routeRegistry): OpenApiDocument {
  const paths: OpenApiDocument["paths"] = {};

  for (const entry of entries) {
    for (const { path, method, operation } of expandEntry(entry)) {
      if (!paths[path]) paths[path] = {};
      if (paths[path][method]) {
        throw new Error(`Duplicate OpenAPI operation ${method.toUpperCase()} ${path}`);
      }
      // Metrics has an additional deployment-dependent bearer check after the
      // middleware API key. Keep both schemes in one requirement (AND), and
      // evaluate the same configuration as the handler for each served spec.
      if (path === "/api/metrics" && method === "get") {
        const requirement: Record<string, string[]> = { ApiKeyAuth: [] };
        if (process.env.METRICS_TOKEN) requirement.MetricsBearer = [];
        paths[path][method] = { ...operation, security: [requirement] };
      } else {
        paths[path][method] = operation;
      }
    }
  }

  return {
    openapi: "3.0.3",
    info: {
      title: "Open-Audit API",
      version: "0.1.0",
      description:
        "HTTP API for the Open-Audit Soroban event indexer: query translated " +
        "events, export history, manage webhooks, and inspect system health. " +
        "Most routes require an `x-api-key` header (see securitySchemes).",
    },
    servers: [{ url: "/", description: "Current host" }],
    tags: [
      { name: "Events", description: "Query and export indexed Soroban events" },
      { name: "Stats", description: "Aggregate indexer statistics" },
      { name: "DAG", description: "Execution DAG lookups" },
      { name: "Webhooks", description: "Webhook subscription management" },
      { name: "Ingestion", description: "Historical backfill controls" },
      { name: "System", description: "Health, status, metrics, and OpenAPI" },
      { name: "IPFS", description: "Offloaded event payload retrieval" },
    ],
    paths,
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: "apiKey",
          in: "header",
          name: "x-api-key",
          description:
            "API key issued by Open-Audit. Required for every /api/* route " +
            "except those listed as public in middleware (currently /api/openapi " +
            "and /api/v1/stats).",
        },
        MetricsBearer: {
          type: "http",
          scheme: "bearer",
          description:
            "Optional Bearer token matching the METRICS_TOKEN env var. " +
            "When METRICS_TOKEN is unset the metrics scrape endpoint is open " +
            "after the middleware API-key check.",
        },
      },
      schemas: { ...componentSchemas },
    },
    security: [{ ApiKeyAuth: [] }],
  };
}
