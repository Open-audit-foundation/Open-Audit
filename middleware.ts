import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/auth/apiKey";
import { checkRateLimit } from "@/lib/auth/rateLimit";

// This middleware depends on ioredis and prom-client (via lib/cache/redisCache
// and lib/metrics), both Node-only packages that are incompatible with the
// Edge runtime. Run on the Node.js runtime instead.
export const runtime = "nodejs";

// Routes that require an API key
const PROTECTED_PREFIXES = ["/api/"];

// Routes that are public even under /api/
// /api/health is used by load balancers and Kubernetes liveness/readiness
// probes, /api/metrics is scraped by Prometheus, and /api/status is polled
// client-side by the /status dashboard page — none of these send an API key.
const PUBLIC_ROUTES = new Set(["/api/v1/stats", "/api/health", "/api/metrics", "/api/status"]);

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  const isProtected =
    PROTECTED_PREFIXES.some((p) => pathname.startsWith(p)) &&
    !PUBLIC_ROUTES.has(pathname);

  if (!isProtected) return NextResponse.next();

  const rawKey = request.headers.get("x-api-key") ?? "";
  const record = await validateApiKey(rawKey);

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
