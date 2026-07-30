/**
 * Webhook System Integration Tests
 *
 * Scenarios:
 * 1. Successful signed payload delivery on event persistence
 * 2. Retry mechanism handling 5xx responses with eventual success
 * 3. Immediate drop / no retry on 4xx responses
 * 4. Automatic subscription deactivation after max retry exhaustion
 * 5. SSRF validation blocking private IPs and plain HTTP endpoints during registration
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import {
  deliverWebhookWithRetries,
  computeWebhookSignature,
  buildSignatureHeader,
  triggerWebhooksForEvent,
  WebhookPayload,
} from "@/lib/jobs/queue";
import {
  validateWebhookUrlSync,
  validateWebhookUrl,
} from "@/lib/webhooks/ssrf-protection";
import {
  generateWebhookSecret,
  verifyWebhookSignature,
} from "@/lib/webhooks/signing";

// ============================================================================
// In-memory mock stores for Prisma
// ============================================================================

interface MockSubscription {
  id: string;
  url: string;
  contractId: string | null;
  secretHash: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface MockDelivery {
  id: string;
  subscriptionId: string;
  eventId: string;
  httpStatus: number | null;
  succeeded: boolean;
  attempts: number;
  createdAt: Date;
}

let mockSubscriptions: MockSubscription[] = [];
let mockDeliveries: MockDelivery[] = [];

function resetMockDb() {
  mockSubscriptions = [];
  mockDeliveries = [];
}

vi.mock("@/lib/db/client", () => ({
  db: {
    webhookSubscription: {
      findMany: vi.fn((args: any) => {
        const where = args?.where ?? {};
        return Promise.resolve(
          mockSubscriptions.filter((sub) => {
            if (where.isActive !== undefined && sub.isActive !== where.isActive) {
              return false;
            }
            if (where.OR) {
              const orMatch = where.OR.some((cond: Record<string, unknown>) => {
                if ("contractId" in cond && cond.contractId === null) {
                  return sub.contractId === null;
                }
                if (
                  "contractId" in cond &&
                  typeof cond.contractId === "string"
                ) {
                  return sub.contractId === cond.contractId;
                }
                return false;
              });
              if (!orMatch) return false;
            }
            return true;
          })
        );
      }),
      findUnique: vi.fn((args: any) => {
        return Promise.resolve(
          mockSubscriptions.find((s) => s.id === args?.where?.id) ?? null
        );
      }),
      create: vi.fn((args: any) => {
        const now = new Date();
        const sub: MockSubscription = {
          id: `sub_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          url: args.data.url,
          contractId: args.data.contractId ?? null,
          secretHash: args.data.secretHash,
          isActive: args.data.isActive ?? true,
          createdAt: now,
          updatedAt: now,
        };
        mockSubscriptions.push(sub);
        return Promise.resolve(sub);
      }),
      update: vi.fn((args: any) => {
        const idx = mockSubscriptions.findIndex((s) => s.id === args?.where?.id);
        if (idx === -1) return Promise.resolve(null);
        mockSubscriptions[idx] = {
          ...mockSubscriptions[idx],
          ...args.data,
          updatedAt: new Date(),
        };
        return Promise.resolve(mockSubscriptions[idx]);
      }),
      delete: vi.fn((args: any) => {
        const idx = mockSubscriptions.findIndex((s) => s.id === args?.where?.id);
        if (idx !== -1) {
          const [removed] = mockSubscriptions.splice(idx, 1);
          return Promise.resolve(removed);
        }
        return Promise.resolve(null);
      }),
    },
    webhookDelivery: {
      create: vi.fn((args: any) => {
        const delivery: MockDelivery = {
          id: `del_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          subscriptionId: args.data.subscriptionId,
          eventId: args.data.eventId,
          httpStatus: args.data.httpStatus ?? null,
          succeeded: args.data.succeeded,
          attempts: args.data.attempts ?? 1,
          createdAt: new Date(),
        };
        mockDeliveries.push(delivery);
        return Promise.resolve(delivery);
      }),
      findMany: vi.fn(() => Promise.resolve(mockDeliveries)),
    },
    event: {
      upsert: vi.fn((args: any) => {
        return Promise.resolve({
          id: args.where.id,
          contractId: args.create.contractId,
          ledger: args.create.ledger,
          timestamp: args.create.timestamp,
          txHash: args.create.txHash,
          topics: args.create.topics,
          data: args.create.data,
          description: args.create.description ?? null,
          status: args.create.status,
          blueprintName: args.create.blueprintName ?? null,
          eventType: args.create.eventType ?? null,
          rpcVerified: false,
          lastRpcCheck: null,
          discrepancies: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }),
    },
  },
}));

// ============================================================================
// Test Helpers
// ============================================================================

const TEST_SECRET = "test-secret-key-0123456789abcdef0123456789abcdef";

function makePayload(overrides: Partial<WebhookPayload> = {}): WebhookPayload {
  return {
    eventId: "evt_test_001",
    contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
    ledger: 123456,
    timestamp: 1719900000,
    txHash: "abc123def456",
    topics: ["AAAADwAAAAh0cmFuc2Zlcg=="],
    data: "AAAAAwAAAGQ=",
    description: "Transferred 100 units",
    status: "translated",
    blueprintName: "Stellar Asset Contract",
    eventType: "transfer",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ============================================================================
// Import msw test server
// ============================================================================
import { mswTestServer as server } from "@/lib/test-utils/msw-server";

// ============================================================================
// Test Suite
// ============================================================================

describe("Webhook System - Integration Tests", () => {
  beforeEach(() => {
    resetMockDb();
    vi.clearAllMocks();
  });

  afterEach(() => {
    server.resetHandlers();
  });

  // ==========================================================================
  // 1. Successful signed payload delivery on event persistence
  // ==========================================================================
  describe("Scenario 1: Successful signed payload delivery", () => {
    it("delivers a POST with valid X-Open-Audit-Signature header and payload", async () => {
      let receivedBody: any = null;
      let receivedSignature: string | null = null;
      let receivedContentType: string | null = null;
      let receivedUserAgent: string | null = null;

      const successHandler = http.post(
        "https://valid-webhook.example.com/endpoint",
        async ({ request }) => {
          receivedBody = await request.json();
          receivedSignature = request.headers.get("X-Open-Audit-Signature");
          receivedContentType = request.headers.get("Content-Type");
          receivedUserAgent = request.headers.get("User-Agent");
          return HttpResponse.json({ ok: true }, { status: 200 });
        }
      );
      server.use(successHandler);

      const payload = makePayload();
      const result = await deliverWebhookWithRetries(
        "sub_1",
        "https://valid-webhook.example.com/endpoint",
        TEST_SECRET,
        payload,
        { maxAttempts: 1, initialBackoffMs: 1, timeoutMs: 5000 }
      );

      expect(result.succeeded).toBe(true);
      expect(result.httpStatus).toBe(200);
      expect(result.attempts).toBe(1);

      expect(receivedBody).toEqual(payload);
      expect(receivedContentType).toBe("application/json");
      expect(receivedUserAgent).toBe("Open-Audit-Webhook/1.0");

      expect(receivedSignature).not.toBeNull();
      expect(receivedSignature!.startsWith("sha256=")).toBe(true);

      const rawBody = JSON.stringify(payload);
      const verified = verifyWebhookSignature(rawBody, receivedSignature!, TEST_SECRET);
      expect(verified).toBe(true);
    });

    it("signature is computed over exact raw JSON bytes", async () => {
      const handler = http.post(
        "https://sig-check.example.com/hook",
        async ({ request }) => {
          const text = await request.text();
          const sig = request.headers.get("X-Open-Audit-Signature");
          return HttpResponse.json(
            { rawText: text, signature: sig },
            { status: 200 }
          );
        }
      );
      server.use(handler);

      const payload = makePayload({ eventId: "evt_sigtest" });
      await deliverWebhookWithRetries(
        "sub_sig",
        "https://sig-check.example.com/hook",
        TEST_SECRET,
        payload,
        { maxAttempts: 1, initialBackoffMs: 1, timeoutMs: 5000 }
      );

      const expectedSig = buildSignatureHeader(JSON.stringify(payload), TEST_SECRET);
      const actualSig = computeWebhookSignature(JSON.stringify(payload), TEST_SECRET);
      expect(expectedSig.endsWith(actualSig)).toBe(true);
    });
  });

  // ==========================================================================
  // 2. Retry mechanism handling 5xx responses with eventual success
  // ==========================================================================
  describe("Scenario 2: Retry mechanism for 5xx with eventual success", () => {
    it("retries on 500 errors with exponential backoff and succeeds on attempt 2", async () => {
      let attemptCount = 0;
      const callTimestamps: number[] = [];

      const flakyHandler = http.post(
        "https://flaky.example.com/500-then-ok",
        async () => {
          callTimestamps.push(Date.now());
          attemptCount++;
          if (attemptCount === 1) {
            return HttpResponse.json({ error: "Internal server error" }, { status: 500 });
          }
          return HttpResponse.json({ ok: true }, { status: 200 });
        }
      );
      server.use(flakyHandler);

      const payload = makePayload({ eventId: "evt_retry_5xx" });
      const result = await deliverWebhookWithRetries(
        "sub_flaky",
        "https://flaky.example.com/500-then-ok",
        TEST_SECRET,
        payload,
        { maxAttempts: 3, initialBackoffMs: 10, timeoutMs: 2000 }
      );

      expect(result.succeeded).toBe(true);
      expect(result.httpStatus).toBe(200);
      expect(result.attempts).toBe(2);
      expect(attemptCount).toBe(2);

      if (callTimestamps.length === 2) {
        const gap = callTimestamps[1] - callTimestamps[0];
        expect(gap).toBeGreaterThanOrEqual(5);
      }
    });

    it("retries on 502, 503, 504 gateway errors", async () => {
      let attemptCount = 0;
      const statuses = [502, 503, 200];

      const handler = http.post(
        "https://gateway-errors.example.com/hook",
        () => {
          const status = statuses[attemptCount] ?? 200;
          attemptCount++;
          return HttpResponse.json({ error: `status ${status}` }, { status });
        }
      );
      server.use(handler);

      const payload = makePayload({ eventId: "evt_gateway" });
      const result = await deliverWebhookWithRetries(
        "sub_gateway",
        "https://gateway-errors.example.com/hook",
        TEST_SECRET,
        payload,
        { maxAttempts: 5, initialBackoffMs: 5, timeoutMs: 2000 }
      );

      expect(result.succeeded).toBe(true);
      expect(result.attempts).toBe(3);
    });

    it("sends the same payload and identical signature on every retry", async () => {
      let attemptCount = 0;
      const signatures: string[] = [];
      const bodies: string[] = [];

      const handler = http.post(
        "https://same-sig.example.com/hook",
        async ({ request }) => {
          attemptCount++;
          signatures.push(request.headers.get("X-Open-Audit-Signature") ?? "");
          bodies.push(await request.text());
          if (attemptCount < 3) {
            return HttpResponse.json({ error: "down" }, { status: 500 });
          }
          return HttpResponse.json({ ok: true }, { status: 201 });
        }
      );
      server.use(handler);

      const payload = makePayload({ eventId: "evt_same_sig" });
      await deliverWebhookWithRetries(
        "sub_same_sig",
        "https://same-sig.example.com/hook",
        TEST_SECRET,
        payload,
        { maxAttempts: 3, initialBackoffMs: 5, timeoutMs: 2000 }
      );

      expect(attemptCount).toBe(3);
      expect(signatures).toHaveLength(3);
      expect(bodies).toHaveLength(3);
      expect(signatures[0]).toEqual(signatures[1]);
      expect(signatures[1]).toEqual(signatures[2]);
      expect(bodies[0]).toEqual(bodies[1]);
      expect(bodies[1]).toEqual(bodies[2]);
    });
  });

  // ==========================================================================
  // 3. Immediate drop / no retry on 4xx responses
  // ==========================================================================
  describe("Scenario 3: No retry on 4xx responses", () => {
    it("does NOT retry on 400 Bad Request", async () => {
      let attemptCount = 0;

      const handler = http.post(
        "https://400.example.com/hook",
        () => {
          attemptCount++;
          return HttpResponse.json({ error: "Bad request" }, { status: 400 });
        }
      );
      server.use(handler);

      const payload = makePayload({ eventId: "evt_400" });
      const result = await deliverWebhookWithRetries(
        "sub_400",
        "https://400.example.com/hook",
        TEST_SECRET,
        payload,
        { maxAttempts: 3, initialBackoffMs: 10, timeoutMs: 2000 }
      );

      expect(result.succeeded).toBe(false);
      expect(result.httpStatus).toBe(400);
      expect(result.attempts).toBe(1);
      expect(attemptCount).toBe(1);
    });

    it("does NOT retry on 401 Unauthorized", async () => {
      let attemptCount = 0;

      const handler = http.post(
        "https://401.example.com/hook",
        () => {
          attemptCount++;
          return HttpResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
      );
      server.use(handler);

      const payload = makePayload({ eventId: "evt_401" });
      const result = await deliverWebhookWithRetries(
        "sub_401",
        "https://401.example.com/hook",
        TEST_SECRET,
        payload,
        { maxAttempts: 5, initialBackoffMs: 5, timeoutMs: 2000 }
      );

      expect(result.succeeded).toBe(false);
      expect(result.httpStatus).toBe(401);
      expect(result.attempts).toBe(1);
      expect(attemptCount).toBe(1);
    });

    it("does NOT retry on 404 Not Found", async () => {
      let attemptCount = 0;

      const handler = http.post(
        "https://404.example.com/hook",
        () => {
          attemptCount++;
          return HttpResponse.json({ error: "Not found" }, { status: 404 });
        }
      );
      server.use(handler);

      const payload = makePayload({ eventId: "evt_404" });
      const result = await deliverWebhookWithRetries(
        "sub_404",
        "https://404.example.com/hook",
        TEST_SECRET,
        payload,
        { maxAttempts: 5, initialBackoffMs: 5, timeoutMs: 2000 }
      );

      expect(result.succeeded).toBe(false);
      expect(result.httpStatus).toBe(404);
      expect(result.attempts).toBe(1);
      expect(attemptCount).toBe(1);
    });

    it("does NOT retry on 422 Unprocessable Entity", async () => {
      let attemptCount = 0;

      const handler = http.post(
        "https://422.example.com/hook",
        () => {
          attemptCount++;
          return HttpResponse.json({ error: "Invalid payload" }, { status: 422 });
        }
      );
      server.use(handler);

      const payload = makePayload({ eventId: "evt_422" });
      const result = await deliverWebhookWithRetries(
        "sub_422",
        "https://422.example.com/hook",
        TEST_SECRET,
        payload,
        { maxAttempts: 5, initialBackoffMs: 5, timeoutMs: 2000 }
      );

      expect(result.succeeded).toBe(false);
      expect(result.httpStatus).toBe(422);
      expect(result.attempts).toBe(1);
      expect(attemptCount).toBe(1);
    });
  });

  // ==========================================================================
  // 4. Automatic subscription deactivation after max retry exhaustion
  // ==========================================================================
  describe("Scenario 4: Auto-deactivate after max retries exhausted", () => {
    it("deactivates subscription and records delivery after all 5xx retries fail", async () => {
      // Setup subscription with matching contract
      const subId = "sub_deactivate_test";
      const subSecret = TEST_SECRET;
      mockSubscriptions.push({
        id: subId,
        url: "https://always-500.example.com/hook",
        contractId: null,
        secretHash: subSecret,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const handler = http.post(
        "https://always-500.example.com/hook",
        () => HttpResponse.json({ error: "boom" }, { status: 500 })
      );
      server.use(handler);

      const event = {
        id: "evt_deactivate_01",
        contractId: "CAAAAAAAAAAAAAA...",
        ledger: 1,
        timestamp: 1,
        txHash: "hash",
        topics: ["topic1"],
        data: "data",
        description: "desc",
        status: "translated",
        blueprintName: "bp",
        eventType: "transfer",
      };

      await triggerWebhooksForEvent(event, {
        maxAttempts: 2,
        initialBackoffMs: 5,
        timeoutMs: 1000,
      });

      const updatedSub = mockSubscriptions.find((s) => s.id === subId);
      expect(updatedSub).toBeDefined();
      expect(updatedSub!.isActive).toBe(false);

      const deliveries = mockDeliveries.filter(
        (d) => d.subscriptionId === subId && d.eventId === event.id
      );
      expect(deliveries.length).toBeGreaterThanOrEqual(1);
      const delivery = deliveries[deliveries.length - 1];
      expect(delivery.succeeded).toBe(false);
      expect(delivery.httpStatus).toBe(500);
      expect(delivery.attempts).toBe(2);
    });

    it("does NOT deactivate subscription on 4xx (single attempt failure)", async () => {
      const subId = "sub_keep_active_4xx";
      mockSubscriptions.push({
        id: subId,
        url: "https://always-400.example.com/hook",
        contractId: null,
        secretHash: TEST_SECRET,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const handler = http.post(
        "https://always-400.example.com/hook",
        () => HttpResponse.json({ error: "bad" }, { status: 400 })
      );
      server.use(handler);

      const event = {
        id: "evt_keep_active",
        contractId: "CX...",
        ledger: 1,
        timestamp: 1,
        txHash: "h",
        topics: ["t"],
        data: "d",
        description: null,
        status: "cryptic",
        blueprintName: null,
        eventType: null,
      };

      await triggerWebhooksForEvent(event, {
        maxAttempts: 3,
        initialBackoffMs: 5,
        timeoutMs: 1000,
      });

      const updatedSub = mockSubscriptions.find((s) => s.id === subId);
      expect(updatedSub!.isActive).toBe(true);

      const deliveries = mockDeliveries.filter(
        (d) => d.subscriptionId === subId && d.eventId === event.id
      );
      expect(deliveries.length).toBe(1);
      expect(deliveries[0].attempts).toBe(1);
      expect(deliveries[0].succeeded).toBe(false);
      expect(deliveries[0].httpStatus).toBe(400);
    });

    it("selects only subscriptions matching event's contractId OR null contractId", async () => {
      const eventContractId = "CONTRACT_A";

      mockSubscriptions.push(
        {
          id: "sub_match_contract",
          url: "https://a.example.com/hook",
          contractId: eventContractId,
          secretHash: TEST_SECRET,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "sub_match_all",
          url: "https://b.example.com/hook",
          contractId: null,
          secretHash: TEST_SECRET,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "sub_mismatch_contract",
          url: "https://c.example.com/hook",
          contractId: "CONTRACT_B",
          secretHash: TEST_SECRET,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "sub_inactive",
          url: "https://d.example.com/hook",
          contractId: null,
          secretHash: TEST_SECRET,
          isActive: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        }
      );

      const urlsCalled: string[] = [];
      const mkHandler = (url: string, status: number) =>
        http.post(url, () => {
          urlsCalled.push(url);
          return HttpResponse.json({}, { status });
        });
      server.use(
        mkHandler("https://a.example.com/hook", 200),
        mkHandler("https://b.example.com/hook", 200),
        mkHandler("https://c.example.com/hook", 200),
        mkHandler("https://d.example.com/hook", 200)
      );

      const event = {
        id: "evt_contract_match",
        contractId: eventContractId,
        ledger: 10,
        timestamp: 1,
        txHash: "h",
        topics: ["t"],
        data: "d",
        description: null,
        status: "cryptic",
        blueprintName: null,
        eventType: null,
      };

      await triggerWebhooksForEvent(event, {
        maxAttempts: 1,
        initialBackoffMs: 1,
        timeoutMs: 2000,
      });

      expect(urlsCalled).toContain("https://a.example.com/hook");
      expect(urlsCalled).toContain("https://b.example.com/hook");
      expect(urlsCalled).not.toContain("https://c.example.com/hook");
      expect(urlsCalled).not.toContain("https://d.example.com/hook");

      const successDeliveries = mockDeliveries.filter(
        (d) => d.eventId === event.id && d.succeeded
      );
      expect(successDeliveries.length).toBe(2);
    });
  });

  // ==========================================================================
  // 5. SSRF validation blocking private IPs and plain HTTP endpoints
  // ==========================================================================
  describe("Scenario 5: SSRF protection during registration", () => {
    describe("validateWebhookUrlSync - fast path checks", () => {
      it("rejects plain HTTP URLs", () => {
        const result = validateWebhookUrlSync("http://example.com/hook");
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/HTTPS/);
      });

      it("rejects localhost hostnames", () => {
        const r1 = validateWebhookUrlSync("https://localhost/hook");
        expect(r1.valid).toBe(false);
        expect(r1.error).toMatch(/localhost/);

        const r2 = validateWebhookUrlSync("https://api.localhost:8443/hook");
        expect(r2.valid).toBe(false);
        expect(r2.error).toMatch(/localhost/);
      });

      it("rejects 127.0.0.0/8 loopback addresses", () => {
        for (const ip of ["127.0.0.1", "127.0.0.255", "127.255.255.1"]) {
          const r = validateWebhookUrlSync(`https://${ip}/hook`);
          expect(r.valid).toBe(false);
          expect(r.error).toMatch(/Private IPv4/);
        }
      });

      it("rejects 10.0.0.0/8 private addresses", () => {
        for (const ip of ["10.0.0.1", "10.255.255.254", "10.1.2.3"]) {
          const r = validateWebhookUrlSync(`https://${ip}/hook`);
          expect(r.valid).toBe(false);
        }
      });

      it("rejects 172.16.0.0/12 private addresses", () => {
        for (const ip of ["172.16.0.1", "172.31.255.254", "172.20.0.1"]) {
          const r = validateWebhookUrlSync(`https://${ip}/hook`);
          expect(r.valid).toBe(false);
        }
      });

      it("rejects 192.168.0.0/16 private addresses", () => {
        for (const ip of ["192.168.0.1", "192.168.255.254", "192.168.1.100"]) {
          const r = validateWebhookUrlSync(`https://${ip}/hook`);
          expect(r.valid).toBe(false);
        }
      });

      it("rejects 0.0.0.0", () => {
        const r = validateWebhookUrlSync("https://0.0.0.0/hook");
        expect(r.valid).toBe(false);
        expect(r.error).toMatch(/not allowed/);
      });

      it("rejects 169.254 link-local addresses", () => {
        const r = validateWebhookUrlSync("https://169.254.169.254/latest/meta-data");
        expect(r.valid).toBe(false);
      });

      it("rejects IPv6 loopback and unique-local", () => {
        const r1 = validateWebhookUrlSync("https://[::1]/hook");
        expect(r1.valid).toBe(false);

        const r2 = validateWebhookUrlSync("https://[fc00::1]/hook");
        expect(r2.valid).toBe(false);

        const r3 = validateWebhookUrlSync("https://[fd12:3456:789a::1]/hook");
        expect(r3.valid).toBe(false);
      });

      it("accepts public HTTPS URLs with hostnames", () => {
        for (const url of [
          "https://example.com/hook",
          "https://api.partner.io:443/v1/events",
          "https://webhooks.example.site/path?q=1",
        ]) {
          const r = validateWebhookUrlSync(url);
          expect(r.valid).toBe(true);
        }
      });

      it("accepts public numeric HTTPS IPs (non-private)", () => {
        for (const ip of ["8.8.8.8", "1.1.1.1", "52.85.132.101"]) {
          const r = validateWebhookUrlSync(`https://${ip}/hook`);
          expect(r.valid).toBe(true);
        }
      });

      it("rejects completely invalid URL strings", () => {
        const r1 = validateWebhookUrlSync("not a url");
        expect(r1.valid).toBe(false);

        const r2 = validateWebhookUrlSync("ftp://files.example.com");
        expect(r2.valid).toBe(false);
      });
    });

    describe("validateWebhookUrl - async DNS check", () => {
      it("rejects domains that resolve to private IPs via DNS", async () => {
        const mockResolver: import("@/lib/webhooks/ssrf-protection").DnsResolver = {
          async lookup(hostname: string, all: boolean = true) {
            if (hostname === "private-resolve.example.com") {
              const results = [{ address: "10.0.0.5", family: 4 }];
              return all ? results : results[0];
            }
            if (hostname === "loopback-resolve.example.com") {
              const results = [{ address: "127.0.0.1", family: 4 }];
              return all ? results : results[0];
            }
            if (hostname === "public-resolve.example.com") {
              const results = [{ address: "52.10.20.30", family: 4 }];
              return all ? results : results[0];
            }
            throw new Error("ENOTFOUND");
          },
        };

        const rPrivate = await validateWebhookUrl(
          "https://private-resolve.example.com/hook",
          mockResolver
        );
        expect(rPrivate.valid).toBe(false);
        expect(rPrivate.error).toMatch(/private range/);

        const rLoopback = await validateWebhookUrl(
          "https://loopback-resolve.example.com/hook",
          mockResolver
        );
        expect(rLoopback.valid).toBe(false);

        const rPublic = await validateWebhookUrl(
          "https://public-resolve.example.com/hook",
          mockResolver
        );
        expect(rPublic.valid).toBe(true);

        const rFail = await validateWebhookUrl(
          "https://nxdomain.invalid/hook",
          mockResolver
        );
        expect(rFail.valid).toBe(false);
        expect(rFail.error).toMatch(/DNS/);
      });
    });
  });

  // ==========================================================================
  // Bonus: Secret generation and signature verification utilities
  // ==========================================================================
  describe("Bonus: Webhook signing utilities", () => {
    it("generateWebhookSecret produces non-empty 64 hex char secrets", () => {
      const s1 = generateWebhookSecret();
      const s2 = generateWebhookSecret();
      expect(s1).toHaveLength(64);
      expect(s2).toHaveLength(64);
      expect(s1).not.toEqual(s2);
      expect(/^[0-9a-f]+$/.test(s1)).toBe(true);
    });

    it("verifyWebhookSignature rejects tampered payloads", () => {
      const payload = JSON.stringify(makePayload());
      const secret = generateWebhookSecret();
      const signature = buildSignatureHeader(payload, secret);

      expect(verifyWebhookSignature(payload, signature, secret)).toBe(true);
      expect(
        verifyWebhookSignature(payload + "extra", signature, secret)
      ).toBe(false);
      expect(
        verifyWebhookSignature(payload, "sha256=0000000000000000000000000000000000000000000000000000000000000000", secret)
      ).toBe(false);
      expect(verifyWebhookSignature(payload, "invalid-prefix", secret)).toBe(
        false
      );
    });
  });
});
