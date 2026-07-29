import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/cache/redisCache", () => ({
  getCachedStats: vi.fn(),
  setCachedStats: vi.fn(),
  isRedisEnabled: vi.fn(() => true),
  initRedis: vi.fn(),
}));

const mockFindMany = vi.fn();
const mockCount = vi.fn();
const mockFindFirst = vi.fn();

vi.mock("@/lib/db/client", () => ({
  db: {
    event: {
      count: (...args: any[]) => mockCount(...args),
      findMany: (...args: any[]) => mockFindMany(...args),
    },
    deadLetterEvent: {
      count: (...args: any[]) => mockCount(...args),
    },
    indexerCursor: {
      findFirst: (...args: any[]) => mockFindFirst(...args),
    },
  },
}));

import { GET } from "./route";
import { getCachedStats, setCachedStats } from "@/lib/cache/redisCache";

beforeEach(() => {
  vi.clearAllMocks();
  mockCount.mockReset();
  mockFindMany.mockReset();
  mockFindFirst.mockReset();
  (getCachedStats as any).mockReset();
  (setCachedStats as any).mockReset();
});

describe("GET /api/v1/stats", () => {
  it("returns aggregated event counts from the database", async () => {
    mockCount
      .mockImplementationOnce(() => Promise.resolve(1000))
      .mockImplementationOnce(() => Promise.resolve(750))
      .mockImplementationOnce(() => Promise.resolve(250))
      .mockImplementationOnce(() => Promise.resolve(3));
    mockFindFirst.mockImplementationOnce(() =>
      Promise.resolve({ lastLedger: 54321000 })
    );
    (getCachedStats as any).mockResolvedValue(null);

    const res = await GET(new NextRequest("http://localhost/api/v1/stats"));
    const body = (await res.json()) as any;

    expect(res.status).toBe(200);
    expect(body.totalEvents).toBe(1000);
    expect(body.translatedCount).toBe(750);
    expect(body.crypticCount).toBe(250);
    expect(body.translationRate).toBe(75);
    expect(body.deadLetterQueueSize).toBe(3);
    expect(body.lastIndexedLedger).toBe(54321000);
  });

  it("returns zeroed stats when no events exist", async () => {
    mockCount
      .mockImplementationOnce(() => Promise.resolve(0))
      .mockImplementationOnce(() => Promise.resolve(0))
      .mockImplementationOnce(() => Promise.resolve(0))
      .mockImplementationOnce(() => Promise.resolve(0));
    mockFindFirst.mockImplementationOnce(() => Promise.resolve(null));
    (getCachedStats as any).mockResolvedValue(null);

    const res = await GET(new NextRequest("http://localhost/api/v1/stats"));
    const body = (await res.json()) as any;

    expect(res.status).toBe(200);
    expect(body.totalEvents).toBe(0);
    expect(body.translatedCount).toBe(0);
    expect(body.crypticCount).toBe(0);
    expect(body.translationRate).toBe(0);
    expect(body.deadLetterQueueSize).toBe(0);
    expect(body.lastIndexedLedger).toBeNull();
  });

  it("computes translation rate correctly for partial translation", async () => {
    mockCount
      .mockImplementationOnce(() => Promise.resolve(10))
      .mockImplementationOnce(() => Promise.resolve(7))
      .mockImplementationOnce(() => Promise.resolve(3))
      .mockImplementationOnce(() => Promise.resolve(0));
    mockFindFirst.mockImplementationOnce(() =>
      Promise.resolve({ lastLedger: 100 })
    );
    (getCachedStats as any).mockResolvedValue(null);

    const res = await GET(new NextRequest("http://localhost/api/v1/stats"));
    const body = (await res.json()) as any;

    expect(res.status).toBe(200);
    expect(body.translationRate).toBe(70);
  });

  it("serves cached stats when Redis has a valid entry", async () => {
    const cached = {
      totalEvents: 500,
      translatedCount: 400,
      crypticCount: 100,
      translationRate: 80,
      deadLetterQueueSize: 1,
      lastIndexedLedger: 99999999,
    };
    (getCachedStats as any).mockResolvedValue(cached);

    const res = await GET(new NextRequest("http://localhost/api/v1/stats"));
    const body = (await res.json()) as any;

    expect(res.status).toBe(200);
    expect(body).toEqual(cached);
    expect(mockCount).not.toHaveBeenCalled();
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it("writes fresh stats to Redis cache after DB query", async () => {
    mockCount
      .mockImplementationOnce(() => Promise.resolve(42))
      .mockImplementationOnce(() => Promise.resolve(42))
      .mockImplementationOnce(() => Promise.resolve(0))
      .mockImplementationOnce(() => Promise.resolve(0));
    mockFindFirst.mockImplementationOnce(() =>
      Promise.resolve({ lastLedger: 42 })
    );
    (getCachedStats as any).mockResolvedValue(null);

    const res = await GET(new NextRequest("http://localhost/api/v1/stats"));
    const body = (await res.json()) as any;

    expect(res.status).toBe(200);
    expect(setCachedStats).toHaveBeenCalledWith(
      expect.objectContaining({
        totalEvents: 42,
        translatedCount: 42,
        crypticCount: 0,
        translationRate: 100,
        deadLetterQueueSize: 0,
        lastIndexedLedger: 42,
      })
    );
  });

  it("returns zeroed fallback payload when the database is unavailable", async () => {
    mockCount.mockRejectedValueOnce(new Error("Database connection failed"));
    mockFindFirst.mockRejectedValueOnce(new Error("Database connection failed"));
    (getCachedStats as any).mockResolvedValue(null);

    const res = await GET(new NextRequest("http://localhost/api/v1/stats"));
    const body = (await res.json()) as any;

    expect(res.status).toBe(200);
    expect(body.totalEvents).toBe(0);
    expect(body.translatedCount).toBe(0);
    expect(body.crypticCount).toBe(0);
    expect(body.translationRate).toBe(0);
    expect(body.deadLetterQueueSize).toBe(0);
    expect(body.lastIndexedLedger).toBeNull();
    expect(body.error).toBe("Database unavailable");
  });

  it("does not cache the fallback payload", async () => {
    mockCount.mockRejectedValueOnce(new Error("Database connection failed"));
    mockFindFirst.mockRejectedValueOnce(new Error("Database connection failed"));
    (getCachedStats as any).mockResolvedValue(null);

    await GET(new NextRequest("http://localhost/api/v1/stats"));

    expect(setCachedStats).not.toHaveBeenCalled();
  });

  it("returns 200 even when Redis read fails", async () => {
    mockCount
      .mockImplementationOnce(() => Promise.resolve(1))
      .mockImplementationOnce(() => Promise.resolve(1))
      .mockImplementationOnce(() => Promise.resolve(0))
      .mockImplementationOnce(() => Promise.resolve(0));
    mockFindFirst.mockImplementationOnce(() =>
      Promise.resolve({ lastLedger: 1 })
    );
    (getCachedStats as any).mockRejectedValueOnce(new Error("Redis down"));

    const res = await GET(new NextRequest("http://localhost/api/v1/stats"));
    const body = (await res.json()) as any;

    expect(res.status).toBe(200);
    expect(body.totalEvents).toBe(1);
    expect(body.translationRate).toBe(100);
  });
});
