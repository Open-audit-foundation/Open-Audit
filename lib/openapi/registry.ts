import type { RegistryEntry } from "./types";

import { routeDoc as openapiDoc } from "./operations/openapi";
import { routeDoc as healthDoc } from "./operations/health";
import { routeDoc as metricsDoc } from "./operations/metrics";
import { routeDoc as statusDoc } from "./operations/status";
import { routeDoc as statsDoc } from "./operations/stats";
import { routeDoc as eventsDoc } from "./operations/events";
import { routeDoc as eventsSearchDoc } from "./operations/events-search";
import { routeDoc as eventsExportDoc } from "./operations/events-export";
import { routeDoc as dagDoc } from "./operations/dag";
import { routeDoc as ingestHistoricalDoc } from "./operations/ingest-historical";
import { routeDoc as ingestHistoricalStatusDoc } from "./operations/ingest-historical-status";
import { routeDoc as ipfsDoc } from "./operations/ipfs";
import { routeDoc as webhooksDoc } from "./operations/webhooks";
import { routeDoc as webhooksIdDoc } from "./operations/webhooks-id";
import { routeDoc as webhooksActivateDoc } from "./operations/webhooks-activate";
import { routeDoc as webhooksDeactivateDoc } from "./operations/webhooks-deactivate";

/**
 * Every route.ts under app/api must appear here so /api/openapi stays complete.
 * The drift test asserts filesystem routes are a subset of this registry (by path).
 */
export const routeRegistry: RegistryEntry[] = [
  { path: "/api/openapi", method: "get", doc: openapiDoc },
  { path: "/api/health", method: "get", doc: healthDoc },
  { path: "/api/metrics", method: "get", doc: metricsDoc },
  { path: "/api/status", method: "get", doc: statusDoc },
  { path: "/api/v1/stats", method: "get", doc: statsDoc },
  { path: "/api/v1/events", method: "get", doc: eventsDoc },
  { path: "/api/v1/events/search", method: "post", doc: eventsSearchDoc },
  { path: "/api/v1/events/export", method: "get", doc: eventsExportDoc },
  { path: "/api/v1/dag", method: "get", doc: dagDoc },
  { path: "/api/ingest-historical", method: "post", doc: ingestHistoricalDoc },
  {
    path: "/api/ingest-historical/status",
    method: "get",
    doc: ingestHistoricalStatusDoc,
  },
  { path: "/api/ipfs/{cid}", method: "get", doc: ipfsDoc },
  { path: "/api/webhooks", doc: webhooksDoc },
  { path: "/api/webhooks/{id}", doc: webhooksIdDoc },
  {
    path: "/api/webhooks/{id}/activate",
    method: "post",
    doc: webhooksActivateDoc,
  },
  {
    path: "/api/webhooks/{id}/deactivate",
    method: "post",
    doc: webhooksDeactivateDoc,
  },
];

/** OpenAPI paths covered by the registry (for drift checks). */
export function registryOpenApiPaths(): string[] {
  return routeRegistry.map((e) => e.path);
}

/**
 * Map a filesystem route folder under app/api to its OpenAPI path.
 * e.g. app/api/webhooks/[id]/activate → /api/webhooks/{id}/activate
 */
export function filesystemRouteToOpenApiPath(routeFile: string): string {
  const normalized = routeFile.replace(/\\/g, "/");
  const marker = "app/api/";
  const idx = normalized.indexOf(marker);
  if (idx < 0) {
    throw new Error(`Not an app/api route file: ${routeFile}`);
  }
  let rel = normalized.slice(idx + marker.length);
  if (rel.endsWith("/route.ts")) rel = rel.slice(0, -"/route.ts".length);
  else if (rel === "route.ts") rel = "";
  const segments = rel.split("/").filter(Boolean);
  const mapped = segments.map((seg) => {
    const m = /^\[(.+)\]$/.exec(seg);
    return m ? `{${m[1]}}` : seg;
  });
  return "/api" + (mapped.length ? "/" + mapped.join("/") : "");
}
