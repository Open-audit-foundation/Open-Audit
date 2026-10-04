import { describe, it, expect, vi, afterEach } from "vitest";
import OpenAPISchemaValidator from "openapi-schema-validator";
import { buildOpenApiDocument } from "../build-spec";
import { filesystemRouteToOpenApiPath, registryOpenApiPaths, routeRegistry } from "../registry";
import fs from "node:fs";
import path from "node:path";

const API_ROOT = path.resolve(__dirname, "../../../app/api");

afterEach(() => {
  vi.unstubAllEnvs();
});

function listRouteFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listRouteFiles(full, acc);
    else if (entry.name === "route.ts") acc.push(full);
  }
  return acc;
}

describe("OpenAPI specification (issue #416)", () => {
  it("builds a document that passes a real OpenAPI 3.0 schema validator", () => {
    const doc = buildOpenApiDocument();
    expect(doc.openapi).toMatch(/^3\.0\./);
    expect(doc.paths).toBeTruthy();
    expect(Object.keys(doc.paths).length).toBeGreaterThan(0);

    const validator = new OpenAPISchemaValidator({ version: 3 });
    const result = validator.validate(doc as any);
    expect(result.errors, JSON.stringify(result.errors, null, 2)).toEqual([]);
  });

  it("includes /api/openapi itself as a documented public path", () => {
    const doc = buildOpenApiDocument();
    expect(doc.paths["/api/openapi"]).toBeTruthy();
    expect(doc.paths["/api/openapi"].get).toBeTruthy();
    expect((doc.paths["/api/openapi"].get as any).security).toEqual([]);
  });

  it("marks /api/v1/stats as public (empty security)", () => {
    const doc = buildOpenApiDocument();
    expect((doc.paths["/api/v1/stats"].get as any).security).toEqual([]);
  });

  it.each([false, true])(
    "validates metrics security with bearer protection configured=%s",
    (configured) => {
      vi.stubEnv("METRICS_TOKEN", configured ? "fixture-metrics-token" : "");
      const doc = buildOpenApiDocument();
      const operation = doc.paths["/api/metrics"].get as {
        security: Array<Record<string, string[]>>;
        parameters?: Array<{ in: string; name: string }>;
      };

      expect(operation.security).toEqual([
        configured ? { ApiKeyAuth: [], MetricsBearer: [] } : { ApiKeyAuth: [] },
      ]);
      expect(
        operation.parameters?.some(
          (parameter) =>
            parameter.in === "header" && parameter.name.toLowerCase() === "authorization"
        ) ?? false
      ).toBe(false);
      const validator = new OpenAPISchemaValidator({ version: 3 });
      const result = validator.validate(doc);
      expect(result.errors, JSON.stringify(result.errors, null, 2)).toEqual([]);
    }
  );
});

describe("routeDoc drift prevention (issue #416)", () => {
  it("every app/api/**/route.ts exports routeDoc", () => {
    const routeFiles = listRouteFiles(API_ROOT);
    expect(routeFiles.length).toBeGreaterThan(0);

    const missing: string[] = [];
    for (const file of routeFiles) {
      const src = fs.readFileSync(file, "utf8");
      const hasExport =
        /export\s+const\s+routeDoc\b/.test(src) || /export\s*\{[^}]*\brouteDoc\b[^}]*\}/.test(src);
      if (!hasExport) missing.push(path.relative(process.cwd(), file));
    }

    expect(missing, `routes missing routeDoc export:\n${missing.join("\n")}`).toEqual([]);
  });

  it("every filesystem route is covered by the OpenAPI registry", () => {
    const routeFiles = listRouteFiles(API_ROOT);
    const registryPaths = new Set(registryOpenApiPaths());
    const uncovered: string[] = [];

    for (const file of routeFiles) {
      const openApiPath = filesystemRouteToOpenApiPath(file);
      if (!registryPaths.has(openApiPath)) {
        uncovered.push(`${path.relative(process.cwd(), file)} → ${openApiPath}`);
      }
    }

    expect(uncovered, `filesystem routes missing from registry:\n${uncovered.join("\n")}`).toEqual(
      []
    );
  });

  it("registry has no duplicate path+method pairs", () => {
    const seen = new Set<string>();
    for (const entry of routeRegistry) {
      if (entry.method) {
        const key = `${entry.method.toUpperCase()} ${entry.path}`;
        expect(seen.has(key), `duplicate ${key}`).toBe(false);
        seen.add(key);
      }
    }
  });
});

describe("middleware public routes (issue #416)", () => {
  it("allowlists /api/openapi and does not mention the mangled ingest path", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../../../middleware.ts"), "utf8");
    expect(src).toContain('"/api/openapi"');
    expect(src).not.toContain("/api/ingest-historical/openapi");
  });
});
