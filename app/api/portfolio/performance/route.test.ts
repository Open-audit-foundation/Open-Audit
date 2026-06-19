import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { GET as getPortfolioPerformance } from "@/app/api/portfolio/performance/route";
import { GET as getAddressPerformance } from "@/app/api/portfolio/[address]/performance/route";

function makeRequest(path: string, params?: Record<string, string>): NextRequest {
  const url = new URL(`http://localhost${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }
  return new NextRequest(url.toString());
}

describe("GET /api/portfolio/performance", () => {
  it("returns 200 with portfolio metrics", async () => {
    const req = makeRequest("/api/portfolio/performance");
    const res = await getPortfolioPerformance(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("totalEvents");
    expect(body).toHaveProperty("uniqueContracts");
    expect(body).toHaveProperty("topContracts");
    expect(body).toHaveProperty("window");
    expect(Array.isArray(body.topContracts)).toBe(true);
  });

  it("accepts from/to query params", async () => {
    const now = Math.floor(Date.now() / 1000);
    const req = makeRequest("/api/portfolio/performance", {
      from: String(now - 7200),
      to: String(now),
    });
    const res = await getPortfolioPerformance(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.window.from).toBe(now - 7200);
    expect(body.window.to).toBe(now);
  });

  it("returns 400 when from > to", async () => {
    const now = Math.floor(Date.now() / 1000);
    const req = makeRequest("/api/portfolio/performance", {
      from: String(now),
      to: String(now - 100),
    });
    const res = await getPortfolioPerformance(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });
});

describe("GET /api/portfolio/[address]/performance", () => {
  it("returns 200 with address metrics", async () => {
    const req = makeRequest("/api/portfolio/GABC1234/performance");
    const res = await getAddressPerformance(req, { params: { address: "GABC1234" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("address", "GABC1234");
    expect(body).toHaveProperty("totalEvents");
    expect(body).toHaveProperty("uniqueContracts");
    expect(body).toHaveProperty("recentActivity");
    expect(Array.isArray(body.recentActivity)).toBe(true);
  });

  it("returns 400 when from > to", async () => {
    const now = Math.floor(Date.now() / 1000);
    const req = makeRequest("/api/portfolio/GABC/performance", {
      from: String(now),
      to: String(now - 1),
    });
    const res = await getAddressPerformance(req, { params: { address: "GABC" } });
    expect(res.status).toBe(400);
  });

  it("returns empty activity for an unknown address", async () => {
    const req = makeRequest("/api/portfolio/GNOBODY999/performance");
    const res = await getAddressPerformance(req, { params: { address: "GNOBODY999" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totalEvents).toBe(0);
    expect(body.recentActivity).toEqual([]);
  });
});
