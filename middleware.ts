import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/auth/apiKey";
import { checkRateLimit } from "@/lib/auth/rateLimit";

// Routes that require an API key
const PROTECTED_PREFIXES = ["/api/"];

// Routes that are public even under /api/
const PUBLIC_ROUTES = new Set(["/api/ingest-historical/openapi"]);

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  const isProtected =
    PROTECTED_PREFIXES.some((p) => pathname.startsWith(p)) &&
    !PUBLIC_ROUTES.has(pathname);

  if (!isProtected) return NextResponse.next();

  const rawKey = request.headers.get("x-api-key") ?? "";
  const record = validateApiKey(rawKey);

  if (!record) {
    return NextResponse.json(
      { error: "Unauthorized", message: "A valid API key is required." },
      { status: 401 }
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
