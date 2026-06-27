/**
 * Unit tests for the webhook delivery engine.
 *
 * All outbound HTTP calls are intercepted via vi.spyOn on globalThis.fetch so
 * no real network traffic is emitted.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { signPayload } from "../sign";

// ── Shared mutable state for the Prisma mock ─────────────────────────────────

const mockSubscriptions: Array<{
  id: string;
  url: string;
  secret: string;
  active: boolean;
}> = [];

const deliveryRecords: Array<{
  subscriptionId: string;
  success: boolean;
  statusCode: number | null;
  attemptCount: number;
}> = [];

const updatedSubscriptions: Array<{ id: string; active: boolean }> = [];

// ── Prisma mock (hoisted before any import of deliver.ts) ─────────────────────

vi.mock("@/lib/db/client", () => ({
  db: {
    webhookSubscription: {
      findMany: vi.fn(
        async ({ where }: { where: { contractId?: string; active: boolean } }) =>
          mockSubscriptions.filter((s) => s.active === where.active)
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: { active: boolean };
        }) => {
          updatedSubscriptions.push({ id: where.id, active: data.active });
        }
      ),
    },
    webhookDelivery: {
      create: vi.fn(
        async ({
          data,
        }: {
          data: {
            subscriptionId: string;
            payload: object;
            statusCode: number | null;
            success: boolean;
            attemptCount: number;
          };
        }) => {
          deliveryRecords.push({
            subscriptionId: data.subscriptionId,
            success: data.success,
            statusCode: data.statusCode,
            attemptCount: data.attemptCount,
          });
        }
      ),
    },
  },
}));

// Import after mock is registered
import { dispatchWebhooks } from "../deliver";

// ── Sample payload ────────────────────────────────────────────────────────────

const PAYLOAD = {
  id: "0000001-0",
  contractId: "CCZYWKX2JOCMFKEBXSYG4XWRMHKBFKDOUBZWEMYGNKHTECYNZP2LKIVA",
  ledger: 52_000_000,
  timestamp: 1_700_000_000,
  txHash: "abc123",
  status: "translated",
  eventType: "Swap",
  description: "Public Key [ABC...] swapped 100 USDC",
  blueprintName: "Soroswap Router",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeResponse(status: number): Response {
  return new Response(null, { status });
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("dispatchWebhooks", () => {
  let fetchSpy: any;

  beforeEach(() => {
    // Reset shared state
    mockSubscriptions.length = 0;
    deliveryRecords.length = 0;
    updatedSubscriptions.length = 0;

    vi.useFakeTimers();
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("delivers successfully on the first attempt and records the delivery", async () => {
    const SECRET = "secret-abc";
    mockSubscriptions.push({
      id: "sub-1",
      url: "https://example.com/hook",
      secret: SECRET,
      active: true,
    });

    fetchSpy.mockResolvedValueOnce(makeResponse(200));

    await dispatchWebhooks(PAYLOAD);

    expect(deliveryRecords).toHaveLength(1);
    expect(deliveryRecords[0].success).toBe(true);
    expect(deliveryRecords[0].statusCode).toBe(200);
    expect(deliveryRecords[0].attemptCount).toBe(1);

    // Subscription must NOT be deactivated on success
    expect(updatedSubscriptions).toHaveLength(0);
  });

  it("attaches a correct HMAC-SHA256 signature header", async () => {
    const SECRET = "hmac-secret";
    mockSubscriptions.push({
      id: "sub-2",
      url: "https://example.com/hook",
      secret: SECRET,
      active: true,
    });

    fetchSpy.mockResolvedValueOnce(makeResponse(200));

    await dispatchWebhooks(PAYLOAD);

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    const body = init.body as string;

    const expectedSig = signPayload(body, SECRET);
    expect(headers["X-Open-Audit-Signature"]).toBe(expectedSig);
  });

  it("retries exactly 3 times on consecutive failures", async () => {
    mockSubscriptions.push({
      id: "sub-3",
      url: "https://example.com/hook",
      secret: "secret",
      active: true,
    });

    fetchSpy
      .mockResolvedValueOnce(makeResponse(500))
      .mockResolvedValueOnce(makeResponse(503))
      .mockResolvedValueOnce(makeResponse(502));

    const promise = dispatchWebhooks(PAYLOAD);
    await vi.runAllTimersAsync();
    await promise;

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(deliveryRecords[0].success).toBe(false);
    expect(deliveryRecords[0].attemptCount).toBe(3);
  });

  it("deactivates the subscription after max failures", async () => {
    mockSubscriptions.push({
      id: "sub-4",
      url: "https://example.com/hook",
      secret: "secret",
      active: true,
    });

    fetchSpy
      .mockResolvedValueOnce(makeResponse(500))
      .mockResolvedValueOnce(makeResponse(500))
      .mockResolvedValueOnce(makeResponse(500));

    const promise = dispatchWebhooks(PAYLOAD);
    await vi.runAllTimersAsync();
    await promise;

    expect(updatedSubscriptions).toHaveLength(1);
    expect(updatedSubscriptions[0]).toEqual({ id: "sub-4", active: false });
  });

  it("does NOT deactivate when a retry eventually succeeds", async () => {
    mockSubscriptions.push({
      id: "sub-5",
      url: "https://example.com/hook",
      secret: "secret",
      active: true,
    });

    // Fail first two, succeed on third
    fetchSpy
      .mockResolvedValueOnce(makeResponse(500))
      .mockResolvedValueOnce(makeResponse(500))
      .mockResolvedValueOnce(makeResponse(201));

    const promise = dispatchWebhooks(PAYLOAD);
    await vi.runAllTimersAsync();
    await promise;

    expect(deliveryRecords[0].success).toBe(true);
    expect(updatedSubscriptions).toHaveLength(0);
  });

  it("records the final HTTP status code on failure", async () => {
    mockSubscriptions.push({
      id: "sub-6",
      url: "https://example.com/hook",
      secret: "secret",
      active: true,
    });

    fetchSpy
      .mockResolvedValueOnce(makeResponse(404))
      .mockResolvedValueOnce(makeResponse(404))
      .mockResolvedValueOnce(makeResponse(404));

    const promise = dispatchWebhooks(PAYLOAD);
    await vi.runAllTimersAsync();
    await promise;

    expect(deliveryRecords[0].statusCode).toBe(404);
  });

  it("records null statusCode on network timeout / error", async () => {
    mockSubscriptions.push({
      id: "sub-7",
      url: "https://example.com/hook",
      secret: "secret",
      active: true,
    });

    fetchSpy.mockRejectedValue(new Error("ECONNREFUSED"));

    const promise = dispatchWebhooks(PAYLOAD);
    await vi.runAllTimersAsync();
    await promise;

    expect(deliveryRecords[0].statusCode).toBeNull();
    expect(deliveryRecords[0].success).toBe(false);
  });

  it("does nothing when there are no active subscriptions", async () => {
    // mockSubscriptions is empty
    await dispatchWebhooks(PAYLOAD);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(deliveryRecords).toHaveLength(0);
  });
});
