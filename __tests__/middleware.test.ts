import path from "path";
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import type { NextRequest, NextResponse } from "next/server";
import {
  validateApiKey,
  validateApiKeyFormat,
  generateApiKey,
  hashKey,
} from "../lib/auth/apiKey";

const PROJECT_ROOT = path.resolve(__dirname, "..");

const makeFakeNextRequest = (
  pathname: string,
  headers: Record<string, string> = {}
): NextRequest => {
  const url = `http://localhost:3000${pathname}`;
  return {
    nextUrl: { pathname },
    headers: new Headers(headers),
    url,
    method: "GET",
    json: async () => ({}),
    text: async () => "",
    formData: async () => new FormData(),
    arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => new Blob(),
    body: null,
    bodyUsed: false,
    clone: () => makeFakeNextRequest(pathname, headers) as NextRequest,
  } as unknown as NextRequest;
};

describe("lib/auth/apiKey.ts - Canonical key store (Issue #15)", () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  describe("key format validation", () => {
    test("accepts properly formatted oa_live_<48hex> keys", () => {
      const { key } = generateApiKey();
      expect(validateApiKeyFormat(key)).toBe(true);
      expect(key.startsWith("oa_live_")).toBe(true);
      expect(key.length).toBe("oa_live_".length + 48);
    });

    test("rejects missing prefix", () => {
      expect(validateApiKeyFormat("0123456789abcdef0123456789abcdef0123456789abcdef")).toBe(false);
    });

    test("rejects wrong prefix", () => {
      expect(validateApiKeyFormat("oa_test_0123456789abcdef0123456789abcdef0123456789abcdef")).toBe(false);
    });

    test("rejects truncated hex portion", () => {
      expect(validateApiKeyFormat("oa_live_0123456789abcdef")).toBe(false);
    });
  });

  describe("hashKey determinism", () => {
    test("identical inputs produce identical SHA-256 hashes", () => {
      const k = "oa_live_0123456789abcdef0123456789abcdef0123456789abcdef";
      expect(hashKey(k)).toBe(hashKey(k));
      expect(hashKey(k)).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe("registry-based validateApiKey (real Issue #15 store contract)", () => {
    test("valid known key in registry passes lookup", () => {
      const { key, hash } = generateApiKey();
      process.env.OA_API_KEYS = `${hash}:free:my-app`;
      const rec = validateApiKey(key);
      expect(rec).not.toBeNull();
      expect(rec!.tier).toBe("free");
      expect(rec!.appName).toBe("my-app");
      expect(rec!.hashedKey).toBe(hash);
    });

    test("key not in registry returns null", () => {
      process.env.OA_API_KEYS = "";
      const { key } = generateApiKey();
      expect(validateApiKey(key)).toBeNull();
    });

    test("empty registry returns null even for well-formed key", () => {
      const { key } = generateApiKey();
      expect(validateApiKey(key)).toBeNull();
    });

    test("partner tier parsed correctly", () => {
      const { key, hash } = generateApiKey();
      process.env.OA_API_KEYS = `${hash}:partner:enterprise-saas`;
      const rec = validateApiKey(key);
      expect(rec!.tier).toBe("partner");
      expect(rec!.appName).toBe("enterprise-saas");
    });

    test("multiple comma-separated registry entries", () => {
      const app1 = generateApiKey();
      const app2 = generateApiKey();
      process.env.OA_API_KEYS = `${app1.hash}:free:app-a,${app2.hash}:partner:app-b`;
      expect(validateApiKey(app1.key)!.tier).toBe("free");
      expect(validateApiKey(app2.key)!.tier).toBe("partner");
    });
  });
});

describe("Edge Middleware - Single Enforcement Point (Integration Behaviour)", () => {
  const originalEnv = { ...process.env };
  let nextJsonSpy: ReturnType<typeof vi.fn>;
  let capturedJson: Array<{ body: unknown; opts?: { status?: number; headers?: Record<string, string> } }>;

  beforeEach(() => {
    process.env = { ...originalEnv, REDIS_URL: "" };
    capturedJson = [];
    nextJsonSpy = vi
      .fn()
      .mockImplementation((body: unknown, opts?: { status?: number; headers?: HeadersInit }) => {
        const headersRecord: Record<string, string> = {};
        if (opts?.headers) {
          const hs = new Headers(opts.headers);
          hs.forEach((v, k) => {
            headersRecord[k] = v;
          });
        }
        capturedJson.push({ body, opts: opts ? { status: opts.status, headers: headersRecord } : undefined });
        return {
          status: opts?.status ?? 200,
          headers: new Headers(opts?.headers),
          _capturedBody: body,
        };
      });

    let nextHeadersSnapshot: Headers | null = null;
    const nextNextSpy = vi.fn().mockImplementation((init?: { headers?: HeadersInit }) => {
      nextHeadersSnapshot = new Headers(init?.headers);
      const mutateHeaders = new Headers(init?.headers);
      return new Proxy(
        {
          status: 200,
          _capturedBody: undefined,
          get headers() {
            return mutateHeaders;
          },
        },
        {
          get(target, prop) {
            if (prop in target) return (target as any)[prop];
            if (prop === "headers") return mutateHeaders;
            return undefined;
          },
        }
      ) as unknown as NextResponse;
    });

    vi.doMock("next/server", async () => {
      const actual = await vi.importActual<typeof import("next/server")>("next/server");
      return {
        ...actual,
        NextResponse: {
          ...(actual.NextResponse as any),
          next: nextNextSpy,
          json: nextJsonSpy,
        },
      };
    });

    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock("next/server");
  });

  const loadMiddleware = () => import(path.join(PROJECT_ROOT, "middleware"));

  test("valid Authorization: Bearer passes through exactly once (no double-check)", async () => {
    const { key, hash } = generateApiKey();
    process.env.OA_API_KEYS = `${hash}:free:once-app`;

    const { middleware } = await loadMiddleware();
    const req = makeFakeNextRequest("/api/v1/events/export", {
      authorization: `Bearer ${key}`,
    });
    const resp = (await middleware(req)) as unknown as {
      status: number;
      headers: Headers;
      _capturedBody?: unknown;
    };

    expect(resp.status).toBe(200);
    expect(resp.headers.get("X-RateLimit-Limit")).toBeTruthy();
    expect(resp.headers.get("X-RateLimit-Remaining")).toBeTruthy();
    expect(resp._capturedBody).toBeUndefined();
    expect(nextJsonSpy).not.toHaveBeenCalled();
  });

  test("missing Authorization → standardized 401 shape { error: 'Unauthorized', message }", async () => {
    process.env.OA_API_KEYS = "";
    const { middleware } = await loadMiddleware();
    const req = makeFakeNextRequest("/api/v1/events/export", {});
    await middleware(req);

    expect(capturedJson).toHaveLength(1);
    const call = capturedJson[0];
    expect(call.opts?.status).toBe(401);
    expect(call.body).toEqual({
      error: "Unauthorized",
      message: "Invalid or missing API key",
    });
    expect(call.opts?.headers?.["www-authenticate"]).toBe('Bearer realm="api"');
  });

  test("malformed Bearer payload → 401 with standardized shape", async () => {
    process.env.OA_API_KEYS = "";
    const { middleware } = await loadMiddleware();
    const req = makeFakeNextRequest("/api/v1/events/export", {
      authorization: "Bearer complete_garbage",
    });
    await middleware(req);

    expect(capturedJson).toHaveLength(1);
    const call = capturedJson[0];
    expect(call.opts?.status).toBe(401);
    const body = call.body as { error: string; message: string };
    expect(body.error).toBe("Unauthorized");
    expect(body.message).toBe("Invalid or missing API key");
  });

  test.each(["/api/v1/stats", "/api/health", "/api/status", "/api/ingest-historical/openapi"])(
    "public route %s is exempt — no Authorization → 200 passthrough without JSON error response",
    async (pathname) => {
      process.env.OA_API_KEYS = "";
      const { middleware } = await loadMiddleware();
      const req = makeFakeNextRequest(pathname, {});
      const resp = (await middleware(req)) as unknown as { status: number; _capturedBody?: unknown };

      expect(resp.status).toBe(200);
      expect(nextJsonSpy).not.toHaveBeenCalled();
      expect(resp._capturedBody).toBeUndefined();
    }
  );

  test("protected /api/v1/* route is blocked even while public /api/v1/stats passes", async () => {
    process.env.OA_API_KEYS = "";
    const { middleware } = await loadMiddleware();

    const publicReq = makeFakeNextRequest("/api/v1/stats", {});
    const protectedReq = makeFakeNextRequest("/api/v1/events/export", {});

    const publicResp = (await middleware(publicReq)) as unknown as { status: number };
    capturedJson.length = 0;
    await middleware(protectedReq);

    expect(publicResp.status).toBe(200);
    expect(capturedJson).toHaveLength(1);
    expect(capturedJson[0].opts?.status).toBe(401);
    const body = capturedJson[0].body as { error: string };
    expect(body.error).toBe("Unauthorized");
  });

  test("429 rate-limit: mocked canonical RL (Issue #16) → flat { error, message } shape + Retry-After", async () => {
    const { key, hash } = generateApiKey();
    process.env.OA_API_KEYS = `${hash}:free:rl-app`;

    const rlMock = vi.fn().mockResolvedValue({
      allowed: false,
      limit: 60,
      remaining: 0,
      retryAfter: 33,
    });
    vi.doMock(path.join(PROJECT_ROOT, "lib/auth/rateLimit"), () => ({
      checkRateLimit: rlMock,
    }));
    vi.resetModules();

    const { middleware } = await loadMiddleware();
    const req = makeFakeNextRequest("/api/v1/events/export", {
      authorization: `Bearer ${key}`,
    });
    await middleware(req);

    expect(rlMock).toHaveBeenCalledTimes(1);
    expect(capturedJson).toHaveLength(1);
    const call = capturedJson[0];
    expect(call.opts?.status).toBe(429);
    const body = call.body as { error: string; message: string };
    expect(body.error).toBe("Too Many Requests");
    expect(body.message).toMatch(/Rate limit exceeded/);
    expect(call.opts?.headers?.["retry-after"]).toBe("33");
    expect(call.opts?.headers?.["x-ratelimit-remaining"]).toBe("0");

    vi.doUnmock(path.join(PROJECT_ROOT, "lib/auth/rateLimit"));
  });

  test("legacy x-api-key header still works as fallback", async () => {
    const { key, hash } = generateApiKey();
    process.env.OA_API_KEYS = `${hash}:free:legacy-app`;
    const { middleware } = await loadMiddleware();

    const req = makeFakeNextRequest("/api/v1/events/export", {
      "x-api-key": key,
    });
    const resp = (await middleware(req)) as unknown as { status: number };
    expect(resp.status).toBe(200);
    expect(nextJsonSpy).not.toHaveBeenCalled();
  });

  test("Authorization: Bearer takes precedence over x-api-key fallback", async () => {
    const good = generateApiKey();
    process.env.OA_API_KEYS = `${good.hash}:free:precedence-app`;
    const { middleware } = await loadMiddleware();

    const req = makeFakeNextRequest("/api/v1/events/export", {
      authorization: `Bearer ${good.key}`,
      "x-api-key": "oa_live_ffffffffffffffffffffffffffffffffffffffffffffffff",
    });
    const resp = (await middleware(req)) as unknown as { status: number };
    expect(resp.status).toBe(200);
  });
});
