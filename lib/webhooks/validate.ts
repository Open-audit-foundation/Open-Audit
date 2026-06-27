/**
 * Webhook input validation helpers.
 *
 * - URL validation with SSRF protection (rejects HTTP, localhost, private CIDRs)
 * - Stellar contract ID format validation
 */

// Stellar contract IDs are 56-character base-32 strings starting with "C"
const STELLAR_CONTRACT_ID_RE = /^C[A-Z2-7]{55}$/;

/**
 * Private/link-local IPv4 CIDR ranges that must not be targeted by webhooks.
 * Covers RFC-1918 private ranges, loopback, link-local, CGNAT, and broadcast.
 */
const PRIVATE_IPV4_RANGES: Array<{ base: number; mask: number }> = [
  { base: ipToInt("10.0.0.0"), mask: 0xff000000 },       // 10.0.0.0/8
  { base: ipToInt("172.16.0.0"), mask: 0xfff00000 },     // 172.16.0.0/12
  { base: ipToInt("192.168.0.0"), mask: 0xffff0000 },    // 192.168.0.0/16
  { base: ipToInt("127.0.0.0"), mask: 0xff000000 },      // 127.0.0.0/8  (loopback)
  { base: ipToInt("169.254.0.0"), mask: 0xffff0000 },    // 169.254.0.0/16 (link-local)
  { base: ipToInt("100.64.0.0"), mask: 0xffc00000 },     // 100.64.0.0/10  (CGNAT)
  { base: ipToInt("0.0.0.0"), mask: 0xff000000 },        // 0.0.0.0/8
  { base: ipToInt("255.255.255.255"), mask: 0xffffffff }, // broadcast
];

function ipToInt(ip: string): number {
  return ip
    .split(".")
    .reduce((acc, octet) => (acc << 8) | parseInt(octet, 10), 0) >>> 0;
}

function isPrivateIPv4(hostname: string): boolean {
  const parts = hostname.split(".");
  if (parts.length !== 4) return false;
  if (parts.some((p) => isNaN(Number(p)))) return false;

  const ipInt = ipToInt(hostname);
  return PRIVATE_IPV4_RANGES.some(
    ({ base, mask }) => (ipInt & mask) === (base & mask)
  );
}

/** Hostnames that are always considered unsafe regardless of resolved IP. */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "ip6-localhost",
  "ip6-loopback",
  "broadcasthost",
]);

export interface UrlValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates a webhook URL.
 *
 * Rules:
 * - Must be a valid URL
 * - Must use HTTPS
 * - Must not target localhost, loopback, or private IP ranges (SSRF prevention)
 */
export function validateWebhookUrl(raw: string): UrlValidationResult {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { valid: false, error: "url must be a valid URL" };
  }

  if (parsed.protocol !== "https:") {
    return {
      valid: false,
      error: "url must use HTTPS — plain HTTP is not permitted",
    };
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return {
      valid: false,
      error: `url hostname '${hostname}' is not allowed — localhost and loopback addresses are rejected`,
    };
  }

  // Reject *.localhost
  if (hostname.endsWith(".localhost")) {
    return {
      valid: false,
      error: `url hostname '${hostname}' is not allowed — .localhost subdomains are rejected`,
    };
  }

  if (isPrivateIPv4(hostname)) {
    return {
      valid: false,
      error: `url hostname '${hostname}' resolves to a private IP range — private/internal addresses are rejected`,
    };
  }

  // Reject IPv6 loopback [::1] and link-local [fe80:...]
  if (hostname === "::1" || hostname.startsWith("fe80:") || hostname === "[::1]") {
    return {
      valid: false,
      error: `url hostname '${hostname}' is an IPv6 loopback or link-local address — not allowed`,
    };
  }

  return { valid: true };
}

/**
 * Validates that a contract ID matches the Stellar contract ID format:
 * 56 uppercase base-32 characters starting with "C".
 */
export function validateContractId(contractId: string): UrlValidationResult {
  if (!contractId || typeof contractId !== "string") {
    return { valid: false, error: "contractId is required" };
  }

  if (!STELLAR_CONTRACT_ID_RE.test(contractId)) {
    return {
      valid: false,
      error:
        "contractId must be a valid Stellar contract address — 56-character base-32 string starting with 'C'",
    };
  }

  return { valid: true };
}
