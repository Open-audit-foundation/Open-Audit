/**
 * Webhook Signing Utilities
 *
 * Provides HMAC-SHA256 signing and signature verification
 * for webhook payloads. Follows the X-Open-Audit-Signature header spec:
 *   X-Open-Audit-Signature: sha256=<hex_digest>
 */

import { createHmac, randomBytes, scryptSync } from "crypto";

const SIGNATURE_HEADER_PREFIX = "sha256=";

export function generateWebhookSecret(): string {
  return randomBytes(32).toString("hex");
}

export function hashSecret(secret: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(secret, salt, 32).toString("hex");
  return `${salt}:${derived}`;
}

export function verifySecretHash(secret: string, storedHash: string): boolean {
  const [salt, expected] = storedHash.split(":");
  if (!salt || !expected) return false;
  const actual = scryptSync(secret, salt, 32).toString("hex");
  return actual === expected;
}

export function computeWebhookSignature(payload: string, secret: string): string {
  const hmac = createHmac("sha256", secret);
  hmac.update(payload, "utf8");
  return hmac.digest("hex");
}

export function buildSignatureHeader(payload: string, secret: string): string {
  return `${SIGNATURE_HEADER_PREFIX}${computeWebhookSignature(payload, secret)}`;
}

export function verifyWebhookSignature(
  payload: string,
  signatureHeader: string,
  secret: string
): boolean {
  if (!signatureHeader.startsWith(SIGNATURE_HEADER_PREFIX)) {
    return false;
  }
  const providedDigest = signatureHeader.slice(SIGNATURE_HEADER_PREFIX.length);
  const expectedDigest = computeWebhookSignature(payload, secret);

  const providedBuf = Buffer.from(providedDigest, "hex");
  const expectedBuf = Buffer.from(expectedDigest, "hex");
  if (providedBuf.length !== expectedBuf.length) {
    return false;
  }

  let diff = 0;
  for (let i = 0; i < expectedBuf.length; i++) {
    diff |= providedBuf[i] ^ expectedBuf[i];
  }
  return diff === 0;
}
