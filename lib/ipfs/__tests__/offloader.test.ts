import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { RawEvent } from "../../translator/types";
import { processEventForIpfs, retrieveIpfsPayload } from "../offloader";

const baseEvent: RawEvent = {
  id: "evt-1",
  contractId: "CDEADBEEF00000000000000000000000000000000000000000000000000",
  topics: ["0xdeadbeef"],
  data: "0x00",
  ledger: 1234,
  timestamp: 1672531200,
  txHash: "abcdef",
};

function eventWithDataLength(byteLength: number): RawEvent {
  return { ...baseEvent, data: "0x" + "a".repeat(byteLength) };
}

function payloadSize(event: RawEvent): number {
  return Buffer.byteLength(JSON.stringify({ data: event.data, topics: event.topics }), "utf-8");
}

describe("processEventForIpfs", () => {
  const originalEnv = { ...process.env };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.IPFS_API_URL = "http://127.0.0.1:5001";
    process.env.IPFS_GATEWAY_URL = "http://127.0.0.1:8080";
    delete process.env.IPFS_OFFLOAD_THRESHOLD_BYTES;
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("size threshold boundary", () => {
    it("passes small payloads through unchanged without calling IPFS", async () => {
      const event = eventWithDataLength(10);
      process.env.IPFS_OFFLOAD_THRESHOLD_BYTES = "2048";

      const result = await processEventForIpfs(event);

      expect(result).toEqual({ data: event.data, topics: event.topics });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("passes a payload exactly at the threshold through unchanged", async () => {
      const event = eventWithDataLength(100);
      const exactSize = payloadSize(event);
      process.env.IPFS_OFFLOAD_THRESHOLD_BYTES = String(exactSize);

      const result = await processEventForIpfs(event);

      expect(result).toEqual({ data: event.data, topics: event.topics });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("offloads a payload one byte over the threshold", async () => {
      const event = eventWithDataLength(100);
      const exactSize = payloadSize(event);
      process.env.IPFS_OFFLOAD_THRESHOLD_BYTES = String(exactSize - 1);

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ Hash: "bafyTestCid123" }),
      });

      const result = await processEventForIpfs(event);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        data: "ipfs://bafyTestCid123",
        topics: ["ipfs://bafyTestCid123"],
      });
    });
  });

  describe("unreachable backend fallback", () => {
    it("returns the original payload when the IPFS API is unset", async () => {
      delete process.env.IPFS_API_URL;
      const event = eventWithDataLength(5000);

      const result = await processEventForIpfs(event);

      expect(result).toEqual({ data: event.data, topics: event.topics });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("returns the original payload and logs a warning when the network call rejects", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const event = eventWithDataLength(5000);
      fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      const result = await processEventForIpfs(event);

      expect(result).toEqual({ data: event.data, topics: event.topics });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain(event.id);
    });

    it("returns the original payload when the IPFS node responds with a non-2xx status", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const event = eventWithDataLength(5000);
      fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });

      const result = await processEventForIpfs(event);

      expect(result).toEqual({ data: event.data, topics: event.topics });
    });

    it("does not drop or corrupt the event when the backend is unreachable", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const event = eventWithDataLength(5000);
      fetchMock.mockRejectedValueOnce(new Error("connect ECONNREFUSED 127.0.0.1:5001"));

      const result = await processEventForIpfs(event);

      // Event must still be broadcastable with its exact original content.
      expect(result.data).toBe(event.data);
      expect(result.topics).toEqual(event.topics);
    });
  });

  describe("round trip", () => {
    it("offload -> CID -> retrieve returns the original data and topics", async () => {
      const event = eventWithDataLength(5000);
      process.env.IPFS_OFFLOAD_THRESHOLD_BYTES = "2048";

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ Hash: "bafyRoundTripCid" }),
      });

      const offloaded = await processEventForIpfs(event);
      expect(offloaded.data).toBe("ipfs://bafyRoundTripCid");

      const cid = offloaded.data.replace(/^ipfs:\/\//, "");

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: event.data, topics: event.topics }),
      });

      const retrieved = await retrieveIpfsPayload(cid);

      expect(retrieved.data).toBe(event.data);
      expect(retrieved.topics).toEqual(event.topics);
    });

    it("falls back to the public gateway when the local Kubo API cat call fails", async () => {
      const event = eventWithDataLength(5000);

      fetchMock
        .mockRejectedValueOnce(new Error("ECONNREFUSED")) // Kubo /api/v0/cat fails
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: event.data, topics: event.topics }),
        }); // gateway fetch succeeds

      const retrieved = await retrieveIpfsPayload("bafySomeCid");

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(retrieved.data).toBe(event.data);
      expect(retrieved.topics).toEqual(event.topics);
    });
  });
});
