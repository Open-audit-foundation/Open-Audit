import { beforeEach, describe, expect, it, vi } from "vitest";
import Ajv from "ajv";
import { NextRequest } from "next/server";

const { findMany, count } = vi.hoisted(() => ({
  findMany: vi.fn(),
  count: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ db: { event: { findMany, count } } }));
vi.mock("@/lib/api/middleware", () => ({
  authenticateAndRateLimit: vi.fn().mockResolvedValue(null),
}));

import { GET as getDocument } from "@/app/api/openapi/route";
import { GET as listEvents } from "@/app/api/v1/events/route";
import { POST as searchEvents } from "@/app/api/v1/events/search/route";

const sources = [null, "live", "historical"] as const;
const rows = sources.map((source, index) => ({
  id: `event-${index}`,
  contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
  ledger: 100 + index,
  timestamp: 1_700_000_000,
  txHash: "a".repeat(64),
  topics: ["0x74726e73"],
  data: "0x00",
  description: null,
  status: "cryptic",
  blueprintName: null,
  eventType: null,
  schemaVersion: null,
  executionDagId: null,
  source,
  createdAt: new Date("2026-10-04T00:00:00Z"),
  updatedAt: new Date("2026-10-04T00:00:00Z"),
}));

beforeEach(() => {
  findMany.mockReset().mockResolvedValue(rows);
  count.mockReset().mockResolvedValue(rows.length);
});

describe("served OpenAPI event response schemas", () => {
  it.each([
    ["/api/v1/events", "get", listEvents],
    ["/api/v1/events/search", "post", searchEvents],
  ] as const)("accepts legacy and tagged events returned by %s", async (path, method, handler) => {
    const request = new NextRequest(`http://localhost${path}`, {
      method: method.toUpperCase(),
      ...(method === "post" ? { headers: { "content-type": "application/json" }, body: "{}" } : {}),
    });
    const response = await handler(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.events.map((event: { source: unknown }) => event.source)).toEqual(sources);

    // Use the actual public response, not a duplicate hand-written schema.
    const documentResponse = await getDocument();
    expect(documentResponse.status).toBe(200);
    const document = await documentResponse.json();
    const schema = document.paths[path][method].responses["200"].content["application/json"].schema;
    const ajv = new Ajv({ strict: false, validateFormats: false, allErrors: true });
    const validate = ajv.compile({ ...schema, components: document.components });
    expect(validate(body), JSON.stringify(validate.errors)).toBe(true);

    // Admitting null must not remove the source vocabulary or type constraint.
    for (const source of ["unknown", 0]) {
      const invalid = { ...body, events: [{ ...body.events[0], source }] };
      expect(validate(invalid)).toBe(false);
    }
  });
});
