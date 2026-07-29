import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

export const defaultHandlers = [
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
              contractId:
                body.params?.filters?.[0]?.contractIds?.[0] ||
                "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
              id: "0000000000000000001-0000000000",
              pagingToken: "0000000000000000001-0000000000",
              topic: [
                "AAAADwAAAAh0cmFuc2Zlcg==",
                "AAAADwAAAAhmcm9tX3ZhbA==",
                "AAAADwAAAAZ0b192YWwAAA==",
              ],
              value: "AAAAAwAAAGQ=",
            },
          ],
          latestLedger: 123456,
          cursor: "0000000000000000001-0000000000",
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

export function createMswTestServer(extraHandlers: any[] = []) {
  return setupServer(...defaultHandlers, ...extraHandlers);
}

export const mswTestServer = createMswTestServer();
