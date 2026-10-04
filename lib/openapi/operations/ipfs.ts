import type { OperationDoc } from "../types";

/** GET /api/ipfs/{cid} */
export const routeDoc: OperationDoc = {
  summary: "Resolve offloaded IPFS payload",
  description:
    "Server-side proxy that resolves a CID previously produced by the " +
    "IPFS offloader back into its { data, topics } payload.",
  operationId: "getIpfsPayload",
  tags: ["IPFS"],
  parameters: [
    {
      name: "cid",
      in: "path",
      required: true,
      schema: { type: "string" },
      description: "IPFS content identifier",
    },
  ],
  responses: {
    "200": {
      description: "Resolved payload",
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              data: {},
              topics: { type: "array", items: { type: "string" } },
            },
          },
        },
      },
    },
    "400": { description: "Missing CID" },
    "401": { description: "Missing or invalid API key" },
    "429": { description: "Rate limit exceeded" },
    "502": { description: "IPFS content unavailable" },
  },
};
