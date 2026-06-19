import { beforeAll, afterEach, afterAll } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import {
  isValidHex,
  sanitizeHex,
  escapeHtml,
  detectScValType,
  decodeMap,
  decodeVec,
  decodeEnum,
  decodeScVal,
} from "./lib/translator/decode";
import { matchesEventCriteria } from "./lib/translator/registry";

// Expose as implicit globals so existing test files that reference these
// functions without explicit imports continue to work.
Object.assign(globalThis, {
  isValidHex,
  sanitizeHex,
  escapeHtml,
  detectScValType,
  decodeMap,
  decodeVec,
  decodeEnum,
  decodeScVal,
  matchesEventCriteria,
});

export const handlers = [
  // Intercept Soroban RPC POST requests
  http.post("https://soroban-testnet.stellar.org", async ({ request }) => {
    const body = (await request.json()) as any;

    if (body.method === "getLatestLedger") {
      return HttpResponse.json({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          sequence: 123456,
          protocolVersion: 20,
        },
      });
    }

    if (body.method === "getEvents") {
      return HttpResponse.json({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          events: [
            {
              type: "contract",
              ledger: 123456,
              ledgerClosedAt: "2026-06-17T17:11:21Z",
              contractId: body.params?.filters?.[0]?.contractIds?.[0] || "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
              id: "0000000000000000001-0000000000",
              pagingToken: "0000000000000000001-0000000000",
              topic: [
                "AAAADwAAAAh0cmFuc2Zlcg==", // Symbol "transfer"
                "AAAADwAAAAhmcm9tX3ZhbA==", // Symbol "from_val"
                "AAAADwAAAAZ0b192YWwAAA=="  // Symbol "to_val"
              ],
              value: "AAAAAwAAAGQ=" // U32 100
            }
          ],
          latestLedger: 123456,
          cursor: "0000000000000000001-0000000000"
        },
      });
    }

    return HttpResponse.json(
      {
        jsonrpc: "2.0",
        id: body.id,
        error: {
          code: -32601,
          message: `Method not found: ${body.method}`,
        },
      },
      { status: 404 }
    );
  }),
];

export const server = setupServer(...handlers);

beforeAll(() => server.listen({ onUnhandledRequest: "warn" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
