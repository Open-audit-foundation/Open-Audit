/**
 * OpenAPI routeDoc types — mirrors the shape already used by
 * app/api/ingest-historical/route.ts so every API route can export the
 * same convention and the /api/openapi aggregator can assemble a spec.
 */

export type HttpMethod =
  | "get"
  | "post"
  | "put"
  | "patch"
  | "delete"
  | "options"
  | "head";

/** OpenAPI 3.0 Parameter Object (subset we author by hand). */
export type ParameterDoc = {
  name: string;
  in: "query" | "path" | "header" | "cookie";
  required?: boolean;
  description?: string;
  schema: Record<string, unknown>;
};

/** OpenAPI 3.0 Media Type / Request Body (subset). */
export type RequestBodyDoc = {
  required?: boolean;
  description?: string;
  content: Record<string, { schema: Record<string, unknown> }>;
};

/** OpenAPI 3.0 Response Object (subset). */
export type ResponseDoc = {
  description: string;
  content?: Record<string, { schema: Record<string, unknown> }>;
  headers?: Record<string, Record<string, unknown>>;
};

/**
 * Operation-level metadata — the flat shape already used by
 * ingest-historical (summary / description / requestBody / responses).
 */
export type OperationDoc = {
  summary: string;
  description?: string;
  operationId?: string;
  tags?: string[];
  parameters?: ParameterDoc[];
  requestBody?: RequestBodyDoc;
  responses: Record<string, ResponseDoc>;
  /** Override global security. Use [] for public endpoints. */
  security?: Array<Record<string, string[]>>;
  deprecated?: boolean;
};

/**
 * Flat routeDoc (single HTTP method) — existing ingest-historical pattern.
 * Multi-method routes instead export a map keyed by HTTP method.
 */
export type RouteDoc = OperationDoc | Partial<Record<HttpMethod, OperationDoc>>;

export type RegistryEntry = {
  /** OpenAPI path template, e.g. /api/webhooks/{id} */
  path: string;
  /**
   * When `doc` is a flat OperationDoc, this is the single method it documents.
   * Ignored when `doc` is a method-keyed map.
   */
  method?: HttpMethod;
  doc: RouteDoc;
};

export const HTTP_METHODS: HttpMethod[] = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "options",
  "head",
];

/** True when routeDoc is a per-method map rather than a flat OperationDoc. */
export function isMethodMap(
  doc: RouteDoc
): doc is Partial<Record<HttpMethod, OperationDoc>> {
  if (!doc || typeof doc !== "object") return false;
  // Flat OperationDocs always have `responses` at the top level.
  if ("responses" in doc && doc.responses && typeof doc.responses === "object") {
    return false;
  }
  return HTTP_METHODS.some((m) => {
    const op = (doc as Partial<Record<HttpMethod, OperationDoc>>)[m];
    return !!op && typeof op === "object" && "responses" in op;
  });
}
