import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/auth/apiKey";
import { checkRateLimit } from "@/lib/auth/rateLimit";

const PROTECTED_PREFIXES = ["/api/"];

const PUBLIC_ROUTES = new Set([
  "/api/ingest-historical/openapi",
  "/api/v1/stats",
  "/api/health",
  "/api/status",
]);

function extractApiKey(request: NextRequest): string {
  const authHeader = request.headers.get("authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  return "";
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  const isProtected =
    PROTECTED_PREFIXES.some((p) => pathname.startsWith(p)) &&
    !PUBLIC_ROUTES.has(pathname);

  if (!isProtected) return NextResponse.next();

  const rawKey = extractApiKey(request);
  const record = await validateApiKey(rawKey);

  if (!record) {
    return NextResponse.json(
      {
        error: "Unauthorized",
        message: "Invalid or missing API key",
      },
      {
        status: 401,
        headers: {
          "WWW-Authenticate": 'Bearer realm="api"',
        },
      }
    );
  }

  const rl = await checkRateLimit(record.hashedKey, record.tier);

  const response = NextResponse.next();
  response.headers.set("X-RateLimit-Limit", String(rl.limit));
  response.headers.set("X-RateLimit-Remaining", String(rl.remaining));

  if (!rl.allowed) {
    return NextResponse.json(
      {
        error: "Too Many Requests",
        message: "Rate limit exceeded. Check the Retry-After header.",
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(rl.retryAfter ?? 60),
          "X-RateLimit-Limit": String(rl.limit),
          "X-RateLimit-Remaining": "0",
        },
      }
    );
  }

  return response;
}

export const config = {
  matcher: "/api/:path*",
};
