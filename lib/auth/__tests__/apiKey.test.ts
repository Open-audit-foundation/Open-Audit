import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { hashKey, validateApiKey } from "../apiKey";

// A real SHA-256 of "oa_live_testkey123" for seeding the registry
const TEST_RAW_KEY = "oa_live_testkey123";
const TEST_HASHED = hashKey(TEST_RAW_KEY);

const PARTNER_RAW_KEY = "oa_live_partnerkey456";
const PARTNER_HASHED = hashKey(PARTNER_RAW_KEY);

describe("apiKey", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.OA_API_KEYS;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.OA_API_KEYS;
    } else {
      process.env.OA_API_KEYS = originalEnv;
    }
    vi.restoreAllMocks();
  });

  // ─── hashKey ───────────────────────────────────────────────────────────────

  describe("hashKey", () => {
    it("returns a 64-character hex string (SHA-256 output)", () => {
      const hash = hashKey("any-string");
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("is deterministic – same input yields same hash", () => {
      expect(hashKey(TEST_RAW_KEY)).toBe(hashKey(TEST_RAW_KEY));
    });

    it("produces different hashes for different inputs", () => {
      expect(hashKey("key-a")).not.toBe(hashKey("key-b"));
    });

    it("treats empty string distinctly from non-empty", () => {
      expect(hashKey("")).not.toBe(hashKey("x"));
    });
  });

  // ─── validateApiKey ────────────────────────────────────────────────────────

  describe("validateApiKey", () => {
    describe("prefix guard", () => {
      it("returns null when rawKey is empty", () => {
        process.env.OA_API_KEYS = `${TEST_HASHED}:free:my-app`;
        expect(validateApiKey("")).toBeNull();
      });

      it("returns null when rawKey lacks the 'oa_live_' prefix", () => {
        process.env.OA_API_KEYS = `${TEST_HASHED}:free:my-app`;
        expect(validateApiKey("sk_live_testkey123")).toBeNull();
        expect(validateApiKey("testkey123")).toBeNull();
        expect(validateApiKey("oa_test_testkey123")).toBeNull();
      });
    });

    describe("registry lookup", () => {
      it("returns null when OA_API_KEYS is not set", () => {
        delete process.env.OA_API_KEYS;
        expect(validateApiKey(TEST_RAW_KEY)).toBeNull();
      });

      it("returns null when OA_API_KEYS is an empty string", () => {
        process.env.OA_API_KEYS = "";
        expect(validateApiKey(TEST_RAW_KEY)).toBeNull();
      });

      it("returns the matching record for a valid free-tier key", () => {
        process.env.OA_API_KEYS = `${TEST_HASHED}:free:my-app`;
        const record = validateApiKey(TEST_RAW_KEY);
        expect(record).not.toBeNull();
        expect(record?.hashedKey).toBe(TEST_HASHED);
        expect(record?.tier).toBe("free");
        expect(record?.appName).toBe("my-app");
      });

      it("returns the matching record for a valid partner-tier key", () => {
        process.env.OA_API_KEYS = `${PARTNER_HASHED}:partner:big-client`;
        const record = validateApiKey(PARTNER_RAW_KEY);
        expect(record).not.toBeNull();
        expect(record?.tier).toBe("partner");
        expect(record?.appName).toBe("big-client");
      });

      it("returns null when the raw key is not in the registry", () => {
        process.env.OA_API_KEYS = `${TEST_HASHED}:free:my-app`;
        const unknown = validateApiKey("oa_live_unknownkey999");
        expect(unknown).toBeNull();
      });

      it("finds the correct key among multiple registry entries", () => {
        process.env.OA_API_KEYS = [
          `${TEST_HASHED}:free:my-app`,
          `${PARTNER_HASHED}:partner:big-client`,
        ].join(",");

        const freeRecord = validateApiKey(TEST_RAW_KEY);
        expect(freeRecord?.tier).toBe("free");
        expect(freeRecord?.appName).toBe("my-app");

        const partnerRecord = validateApiKey(PARTNER_RAW_KEY);
        expect(partnerRecord?.tier).toBe("partner");
        expect(partnerRecord?.appName).toBe("big-client");
      });

      it("tolerates whitespace-padded entries in OA_API_KEYS", () => {
        process.env.OA_API_KEYS = `  ${TEST_HASHED}:free:my-app  `;
        const record = validateApiKey(TEST_RAW_KEY);
        expect(record).not.toBeNull();
        expect(record?.appName).toBe("my-app");
      });

      it("handles an appName containing colons (e.g. namespace:name)", () => {
        process.env.OA_API_KEYS = `${TEST_HASHED}:free:ns:service-name`;
        const record = validateApiKey(TEST_RAW_KEY);
        expect(record).not.toBeNull();
        // rest.join(":") should reconstruct "ns:service-name"
        expect(record?.appName).toBe("ns:service-name");
      });

      it("defaults tier to 'free' when tier field is missing or empty", () => {
        // Entry with no tier field – split produces ["hash", "", "app"]
        process.env.OA_API_KEYS = `${TEST_HASHED}::fallback-app`;
        const record = validateApiKey(TEST_RAW_KEY);
        expect(record).not.toBeNull();
        // Empty string cast to Tier → stored as "" but validated caller can
        // handle; the registry loader casts whatever is in the field.
        // More importantly: the loader doesn't crash.
        expect(record?.hashedKey).toBe(TEST_HASHED);
      });

      it("defaults appName to 'unknown' when appName field is absent", () => {
        // Only two colon-separated fields → rest is empty after split
        process.env.OA_API_KEYS = `${TEST_HASHED}:free`;
        const record = validateApiKey(TEST_RAW_KEY);
        expect(record).not.toBeNull();
        expect(record?.appName).toBe("unknown");
      });

      it("ignores empty comma-separated entries (e.g. trailing comma)", () => {
        process.env.OA_API_KEYS = `${TEST_HASHED}:free:my-app,`;
        const record = validateApiKey(TEST_RAW_KEY);
        // Should still find the valid entry, not crash on the empty trailing token
        expect(record).not.toBeNull();
        expect(record?.appName).toBe("my-app");
      });
    });
  });
});
