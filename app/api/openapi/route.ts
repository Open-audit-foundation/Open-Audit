import { NextResponse } from "next/server";
import { buildOpenApiDocument } from "@/lib/openapi/build-spec";

export { routeDoc } from "@/lib/openapi/operations/openapi";

/**
 * GET /api/openapi
 *
 * Serves the aggregated OpenAPI 3.0 document built from every routeDoc
 * registered in lib/openapi/registry.ts. Public (see middleware PUBLIC_ROUTES).
 */
export async function GET(): Promise<NextResponse> {
  const document = buildOpenApiDocument();
  return NextResponse.json(document, {
    headers: {
      "Cache-Control": "public, max-age=60",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
