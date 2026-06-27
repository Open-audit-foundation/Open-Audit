import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import { signPayload, verifySignature } from "../sign";

const SECRET = "test-secret-32bytes-xxxxxxxxxxxxxxx";
const BODY = JSON.stringify({ contractId: "CTEST", eventType: "Transfer" });

describe("signPayload", () => {
  it("returns a sha256= prefixed hex signature", () => {
    const sig = signPayload(BODY, SECRET);
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it("matches a manually-computed HMAC-SHA256", () => {
    const expected =
      "sha256=" +
      createHmac("sha256", SECRET).update(BODY, "utf8").digest("hex");
    expect(signPayload(BODY, SECRET)).toBe(expected);
  });

  it("produces different signatures for different secrets", () => {
    const sig1 = signPayload(BODY, "secret-one");
    const sig2 = signPayload(BODY, "secret-two");
    expect(sig1).not.toBe(sig2);
  });

  it("produces different signatures for different payloads", () => {
    const sig1 = signPayload('{"a":1}', SECRET);
    const sig2 = signPayload('{"a":2}', SECRET);
    expect(sig1).not.toBe(sig2);
  });
});

describe("verifySignature", () => {
  it("returns true for a matching signature", () => {
    const sig = signPayload(BODY, SECRET);
    expect(verifySignature(BODY, SECRET, sig)).toBe(true);
  });

  it("returns false for a tampered body", () => {
    const sig = signPayload(BODY, SECRET);
    expect(verifySignature(BODY + "x", SECRET, sig)).toBe(false);
  });

  it("returns false for a wrong secret", () => {
    const sig = signPayload(BODY, SECRET);
    expect(verifySignature(BODY, "wrong-secret", sig)).toBe(false);
  });

  it("returns false for a tampered signature", () => {
    const sig = signPayload(BODY, SECRET);
    const tampered = sig.slice(0, -2) + "ff";
    expect(verifySignature(BODY, SECRET, tampered)).toBe(false);
  });
});
