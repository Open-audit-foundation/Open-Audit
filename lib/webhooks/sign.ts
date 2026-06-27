/**
 * HMAC-SHA256 signing for webhook deliveries.
 *
 * Every outbound webhook request is signed with:
 *   X-Open-Audit-Signature: sha256=<hex digest>
 *
 * Receivers can verify by computing HMAC-SHA256 over the raw request body
 * using the subscription's secret and comparing with the header value.
 */

import { createHmac } from "crypto";

/**
 * Computes the HMAC-SHA256 signature for a webhook payload.
 *
 * @param body   - The raw JSON string that will be sent as the request body.
 * @param secret - The subscription's signing secret.
 * @returns      Signature string in the form `sha256=<hex>`.
 */
export function signPayload(body: string, secret: string): string {
  const hmac = createHmac("sha256", secret);
  const hex = hmac.update(body, "utf8").digest("hex");
  return `sha256=${hex}`;
}

/**
 * Verifies an incoming signature header against an expected body + secret.
 * Constant-time comparison to prevent timing attacks.
 *
 * @returns true if the signature is valid.
 */
export function verifySignature(
  body: string,
  secret: string,
  signatureHeader: string
): boolean {
  const { timingSafeEqual } = require("crypto") as typeof import("crypto");
  const expected = signPayload(body, secret);
  try {
    return timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(signatureHeader, "utf8"));
  } catch {
    return false;
  }
}
