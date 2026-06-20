import { NextRequest, NextResponse } from "next/server";
import { getApiKeyByHash, hashApiKey, validateApiKeyFormat } from "./apiKeys";
import { checkRateLimit } from "./rateLimiter";

export async function authenticateAndRateLimit(request: NextRequest): Promise<NextResponse | null> {
  const authHeader = request.headers.get("authorization");
  
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: "Unauthorized: Missing or invalid Authorization header" },
      { status: 401 }
    );
  }

  const apiKey = authHeader.slice(7);
  
  if (!validateApiKeyFormat(apiKey)) {
    return NextResponse.json(
      { error: "Unauthorized: Invalid API key format" },
      { status: 401 }
    );
  }

  const keyHash = hashApiKey(apiKey);
  const apiKeyRecord = await getApiKeyByHash(keyHash);

  if (!apiKeyRecord || !apiKeyRecord.isActive) {
    return NextResponse.json(
      { error: "Unauthorized: Invalid or inactive API key" },
      { status: 401 }
    );
  }

  const rateLimit = await checkRateLimit(apiKeyRecord.id, apiKeyRecord.tier);

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too Many Requests" },
      {
        status: 429,
        headers: {
          "Retry-After": rateLimit.resetAfter.toString(),
          "X-RateLimit-Limit": RATE_LIMITS[apiKeyRecord.tier].requestsPerMinute.toString(),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": (Date.now() + rateLimit.resetAfter * 1000).toString(),
        },
      }
    );
  }

  return null;
}

import { RATE_LIMITS } from "./types";
