import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "./route";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { authenticateAndRateLimit } from "@/lib/api/middleware";

vi.mock("@/lib/api/middleware", () => ({
  authenticateAndRateLimit: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  db: {
    event: {
      findUnique: vi.fn(),
    },
  },
}));

describe("GET /api/v1/events/[id]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  const createRequest = () => {
    return new NextRequest("http://localhost/api/v1/events/some-id", {
      headers: {
        authorization: "Bearer test_key",
      },
    });
  };

  it("returns 401 when authentication fails", async () => {
    const mockAuthResponse = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    vi.mocked(authenticateAndRateLimit).mockResolvedValue(mockAuthResponse);

    const req = createRequest();
    const res = await GET(req, { params: Promise.resolve({ id: "some-id" }) });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: "Unauthorized" });
    expect(db.event.findUnique).not.toHaveBeenCalled();
  });

  it("returns 404 when the event is not found", async () => {
    vi.mocked(authenticateAndRateLimit).mockResolvedValue(null);
    vi.mocked(db.event.findUnique).mockResolvedValue(null);

    const req = createRequest();
    const res = await GET(req, { params: Promise.resolve({ id: "some-id" }) });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: 'Event with ID "some-id" not found' });
    expect(db.event.findUnique).toHaveBeenCalledWith({
      where: { id: "some-id" },
    });
  });

  it("returns 200 and the event when found", async () => {
    const mockEvent = {
      id: "some-id",
      contractId: "C123",
      ledger: 100,
      timestamp: 1626000000,
      txHash: "hash123",
      topics: ["topic1"],
      data: "0xdata",
      description: "Transferred tokens",
      status: "translated",
      blueprintName: "Token",
      eventType: "transfer",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    vi.mocked(authenticateAndRateLimit).mockResolvedValue(null);
    vi.mocked(db.event.findUnique).mockResolvedValue(mockEvent as any);

    const req = createRequest();
    const res = await GET(req, { params: Promise.resolve({ id: "some-id" }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("some-id");
    expect(body.contractId).toBe("C123");
    expect(body.description).toBe("Transferred tokens");
    expect(db.event.findUnique).toHaveBeenCalledWith({
      where: { id: "some-id" },
    });
  });

  it("returns 500 or appropriate error response when database query fails", async () => {
    vi.mocked(authenticateAndRateLimit).mockResolvedValue(null);
    vi.mocked(db.event.findUnique).mockRejectedValue(new Error("Database connection lost"));

    const req = createRequest();
    const res = await GET(req, { params: Promise.resolve({ id: "some-id" }) });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("INTERNAL_ERROR");
    expect(body.message).toBe("Database connection lost");
  });
});
