import { test, expect } from "@playwright/test";
import type { RawEvent } from "../lib/translator/types";
import { injectMockSorobanEvent } from "./helpers/inject-event";

/**
 * E2E: Soroban RPC event → translation → WebSocket → translated text in DOM
 */

const MOCK_SOROBAN_RPC_EVENT: RawEvent = {
  id: `e2e-${Date.now()}-0`,
  contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
  topics: [
    "0x0000000000000000000000000000000000000000000000000000000074726e73",
    "0x00000012000000000000000085a825af25ab38c944150cc569311cf76c80b8b521297c049c5c53204cd43e38",
    "0x000000120000000000000000fa6798a578d9f9f012f70a00cae3d6b15a7ada4518f98ad68c0cab21d16a0f5d",
  ],
  data: "0x00000000000000000000000000000000000000000005F5E100",
  ledger: 52_341_001,
  timestamp: Math.floor(Date.now() / 1000),
  txHash: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
};

test.describe("WebSocket Event Flow", () => {
  test("displays translated event in DOM after WebSocket broadcast", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    const wsPromise = page.waitForEvent("websocket");
    await page.getByRole("button", { name: /live feed/i }).click();
    const ws = await wsPromise;
    await ws.waitForEvent("framesreceived");

    const translated = await injectMockSorobanEvent(MOCK_SOROBAN_RPC_EVENT);

    expect(translated.status).toBe("translated");
    expect(translated.description).toContain("USDC");

    const eventRow = page.locator("[data-testid='event-row']").first();
    await expect(eventRow).toBeVisible({ timeout: 10_000 });
    await expect(eventRow.getByText(translated.description!)).toBeVisible();
    await expect(eventRow.getByText("Transfer")).toBeVisible();
  });

  test("shows live indicator when WebSocket is connected", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    const liveButton = page.getByRole("button", { name: /live feed/i });
    await expect(liveButton).toBeVisible();
    await liveButton.click();

    await expect(page.getByRole("button", { name: /stop live/i })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator(".animate-pulse")).toBeVisible();
  });
});
