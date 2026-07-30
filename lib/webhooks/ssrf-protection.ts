/**
 * SSRF Protection Utilities
 *
 * Validates URLs to prevent Server-Side Request Forgery attacks by rejecting:
 * - Non-HTTPS URLs (http://)
 * - Private/loopback IP ranges
 * - localhost hostnames
 *
 * Uses dependency injection for DNS lookups to support testability without
 * module-level patching hacks.
 */

import * as dns from "dns";
import { promisify } from "util";

export interface DnsLookupResult {
  address: string;
  family: number;
}

export interface DnsResolver {
  lookup(hostname: string, all?: boolean): Promise<DnsLookupResult[] | DnsLookupResult>;
}

const defaultLookup = promisify(dns.lookup);

export const defaultDnsResolver: DnsResolver = {
  async lookup(hostname: string, all: boolean = true): Promise<DnsLookupResult[] | DnsLookupResult> {
    if (all) {
      const results = await defaultLookup(hostname, { all: true });
      return results as DnsLookupResult[];
    }
    const result = await defaultLookup(hostname);
    return { address: result.address, family: result.family };
  },
};

const PRIVATE_IP_RANGES: Array<{ network: bigint; mask: bigint }> = [
  ipv4CidrToRange("127.0.0.0", 8),
  ipv4CidrToRange("10.0.0.0", 8),
  ipv4CidrToRange("172.16.0.0", 12),
  ipv4CidrToRange("192.168.0.0", 16),
  ipv4CidrToRange("169.254.0.0", 16),
  ipv4CidrToRange("0.0.0.0", 8),
];

function ipv4ToBigInt(ip: string): bigint {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    throw new Error(`Invalid IPv4 address: ${ip}`);
  }
  return (
    (BigInt(parts[0]) << 24n) |
    (BigInt(parts[1]) << 16n) |
    (BigInt(parts[2]) << 8n) |
    BigInt(parts[3])
  );
}

function ipv4CidrToRange(network: string, prefix: number): { network: bigint; mask: bigint } {
  const networkInt = ipv4ToBigInt(network);
  const maskInt = prefix === 0 ? 0n : (~0n << (32n - BigInt(prefix))) & 0xffffffffn;
  return { network: networkInt & maskInt, mask: maskInt };
}

function isPrivateIPv4(ip: string): boolean {
  try {
    const ipInt = ipv4ToBigInt(ip);
    return PRIVATE_IP_RANGES.some(({ network, mask }) => (ipInt & mask) === network);
  } catch {
    return false;
  }
}

function isIPv6LoopbackOrPrivate(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower.startsWith("::ffff:127.")) {
    return true;
  }
  if (lower.startsWith("fc") || lower.startsWith("fd")) {
    return true;
  }
  if (lower.startsWith("fe80")) {
    return true;
  }
  return false;
}

function isPrivateIp(ip: string, family: number): boolean {
  if (family === 4) {
    return isPrivateIPv4(ip);
  }
  if (family === 6) {
    return isIPv6LoopbackOrPrivate(ip);
  }
  return false;
}

export interface SsrfValidationResult {
  valid: boolean;
  error?: string;
}

export async function validateWebhookUrl(
  urlString: string,
  resolver: DnsResolver = defaultDnsResolver
): Promise<SsrfValidationResult> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(urlString);
  } catch {
    return { valid: false, error: "Invalid URL format" };
  }

  if (parsedUrl.protocol !== "https:") {
    return { valid: false, error: "Only HTTPS URLs are allowed" };
  }

  const hostname = parsedUrl.hostname.toLowerCase();

  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return { valid: false, error: "localhost URLs are not allowed" };
  }

  if (hostname === "0" || hostname === "0.0.0.0") {
    return { valid: false, error: "0.0.0.0 URLs are not allowed" };
  }

  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    const bracketedIp = hostname.slice(1, -1);
    if (isIPv6LoopbackOrPrivate(bracketedIp)) {
      return { valid: false, error: "Private IPv6 addresses are not allowed" };
    }
  }

  try {
    const resolved = await resolver.lookup(hostname, true);
    const results = Array.isArray(resolved) ? resolved : [resolved];
    for (const entry of results) {
      if (isPrivateIp(entry.address, entry.family)) {
        return {
          valid: false,
          error: `Resolved IP ${entry.address} is in a private range`,
        };
      }
    }
  } catch (err) {
    return { valid: false, error: "DNS resolution failed" };
  }

  return { valid: true };
}

export function validateWebhookUrlSync(urlString: string): SsrfValidationResult {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(urlString);
  } catch {
    return { valid: false, error: "Invalid URL format" };
  }

  if (parsedUrl.protocol !== "https:") {
    return { valid: false, error: "Only HTTPS URLs are allowed" };
  }

  const hostname = parsedUrl.hostname.toLowerCase();

  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return { valid: false, error: "localhost URLs are not allowed" };
  }

  if (hostname === "0" || hostname === "0.0.0.0") {
    return { valid: false, error: "0.0.0.0 URLs are not allowed" };
  }

  const ipv4Pattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const ipv4Match = hostname.match(ipv4Pattern);
  if (ipv4Match) {
    try {
      const parts = ipv4Match.slice(1).map(Number);
      if (parts.every((p) => p >= 0 && p <= 255)) {
        if (isPrivateIPv4(hostname)) {
          return { valid: false, error: "Private IPv4 addresses are not allowed" };
        }
      }
    } catch {
      // fall through
    }
  }

  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    const bracketedIp = hostname.slice(1, -1);
    if (isIPv6LoopbackOrPrivate(bracketedIp)) {
      return { valid: false, error: "Private IPv6 addresses are not allowed" };
    }
  }

  return { valid: true };
}
