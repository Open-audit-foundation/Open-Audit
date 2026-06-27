import { describe, it, expect } from "vitest";
import { validateWebhookUrl, validateContractId } from "../validate";

// ── URL validation ────────────────────────────────────────────────────────────

describe("validateWebhookUrl", () => {
  it("accepts a valid HTTPS URL", () => {
    const result = validateWebhookUrl("https://example.com/hook");
    expect(result.valid).toBe(true);
  });

  it("accepts HTTPS with path and port", () => {
    expect(validateWebhookUrl("https://hooks.example.com:8443/v1/events").valid).toBe(true);
  });

  it("rejects plain HTTP", () => {
    const result = validateWebhookUrl("http://example.com/hook");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/HTTPS/i);
  });

  it("rejects localhost", () => {
    const result = validateWebhookUrl("https://localhost/hook");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/localhost/i);
  });

  it("rejects 127.0.0.1 loopback", () => {
    const result = validateWebhookUrl("https://127.0.0.1/hook");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/private/i);
  });

  it("rejects 127.x.x.x loopback range", () => {
    expect(validateWebhookUrl("https://127.0.0.2/hook").valid).toBe(false);
  });

  it("rejects 10.x.x.x private range", () => {
    expect(validateWebhookUrl("https://10.0.0.1/hook").valid).toBe(false);
  });

  it("rejects 172.16.x.x private range", () => {
    expect(validateWebhookUrl("https://172.16.0.1/hook").valid).toBe(false);
  });

  it("rejects 172.31.x.x private range", () => {
    expect(validateWebhookUrl("https://172.31.255.254/hook").valid).toBe(false);
  });

  it("accepts 172.32.x.x (outside private range)", () => {
    // 172.32.0.0 is outside the /12 block (172.16–172.31)
    expect(validateWebhookUrl("https://172.32.0.1/hook").valid).toBe(true);
  });

  it("rejects 192.168.x.x private range", () => {
    expect(validateWebhookUrl("https://192.168.1.100/hook").valid).toBe(false);
  });

  it("rejects link-local 169.254.x.x", () => {
    expect(validateWebhookUrl("https://169.254.1.1/hook").valid).toBe(false);
  });

  it("rejects CGNAT 100.64.x.x", () => {
    expect(validateWebhookUrl("https://100.64.0.1/hook").valid).toBe(false);
  });

  it("rejects *.localhost subdomains", () => {
    expect(validateWebhookUrl("https://my-service.localhost/hook").valid).toBe(false);
  });

  it("rejects IPv6 loopback [::1]", () => {
    expect(validateWebhookUrl("https://[::1]/hook").valid).toBe(false);
  });

  it("rejects a non-URL string", () => {
    expect(validateWebhookUrl("not-a-url").valid).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(validateWebhookUrl("").valid).toBe(false);
  });
});

// ── Contract ID validation ────────────────────────────────────────────────────

describe("validateContractId", () => {
  const VALID_ID = "CCZYWKX2JOCMFKEBXSYG4XWRMHKBFKDOUBZWEMYGNKHTECYNZP2LKIVA";

  it("accepts a valid Stellar contract ID", () => {
    expect(validateContractId(VALID_ID).valid).toBe(true);
  });

  it("rejects an account address starting with G", () => {
    const gAddress = "GABC" + "A".repeat(52);
    expect(validateContractId(gAddress).valid).toBe(false);
  });

  it("rejects a contract ID that is too short", () => {
    expect(validateContractId("CABC").valid).toBe(false);
  });

  it("rejects a contract ID with lowercase letters", () => {
    expect(validateContractId(VALID_ID.toLowerCase()).valid).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(validateContractId("").valid).toBe(false);
  });

  it("rejects non-string input", () => {
    // @ts-expect-error — intentional wrong type for test
    expect(validateContractId(null).valid).toBe(false);
  });

  it("rejects contract ID with invalid base-32 character '0'", () => {
    // Base-32 uses A–Z and 2–7 only; '0', '1', '8', '9' are invalid
    const withZero = "C" + "0".repeat(55);
    expect(validateContractId(withZero).valid).toBe(false);
  });
});
