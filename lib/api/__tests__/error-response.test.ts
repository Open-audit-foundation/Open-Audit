import { describe, it, expect, vi, beforeEach } from "vitest";
import { StellarNetworkException } from "@/lib/errors";
import { toErrorResponse, validationErrorResponse } from "@/lib/api/error-response";

describe("error-response helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns structured validation responses", async () => {
    const response = validationErrorResponse("chunkSize must be >= 1");
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      error: "chunkSize must be >= 1",
      code: "VALIDATION_ERROR",
      message: "chunkSize must be >= 1",
    });
  });

  it("maps domain exceptions to structured JSON with context", async () => {
    const error = new StellarNetworkException(
      "Failed after retries",
      { contractId: "CABC123", ledgerSequence: 1000 },
      { retriable: true }
    );

    const response = toErrorResponse(error);
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.code).toBe("STELLAR_NETWORK_ERROR");
    expect(body.message).toBe("Failed after retries");
    expect(body.context.contractId).toBe("CABC123");
    expect(body.context.ledgerSequence).toBe(1000);
  });
});
