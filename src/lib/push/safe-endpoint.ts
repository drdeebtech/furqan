import net from "node:net";
import { lookup } from "node:dns/promises";

/**
 * SSRF guard for Web Push endpoints (audit SSRF-VULN-01).
 *
 * A stored push subscription becomes an outbound request target when the cron
 * push-sender fires (`src/lib/push/send.ts`). Without validation an
 * authenticated user can register `https://169.254.169.254/` (cloud metadata)
 * or `https://127.0.0.1:8443/` (an internal service) and turn those crons into
 * a blind SSRF primitive.
 *
 * A legitimate Web Push endpoint is ALWAYS an HTTPS URL on a public DNS
 * hostname (FCM, Mozilla autopush, Apple, WNS) — never a raw IP. So we reject:
 *   - non-HTTPS schemes
 *   - IP-literal hosts, any family/encoding (v4, v6, decimal, hex, octal)
 *   - non-FQDN / internal names (localhost, single-label, *.local, *.internal)
 *
 * This blocks every IP-based SSRF (including the two confirmed live) without
 * rejecting any real push service, because those are all normal FQDNs.
 *
 * The async resolved variant also checks every DNS answer and rejects private,
 * loopback, and link-local IPs to close DNS rebinding.
 */
export function isSafePushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }

  if (url.protocol !== "https:") return false;

  // Strip IPv6 brackets ("[::1]" → "::1") and any trailing FQDN root dot(s):
  // "cache.internal." resolves like "cache.internal" but would slip past the
  // `.endsWith(".internal")` suffix checks below (CodeRabbit SSRF bypass).
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.+$/, "").toLowerCase();

  // Raw IP literal (v4/v6) → not a real push host. Kills 169.254.169.254 / 127.0.0.1 / ::1.
  if (net.isIP(host) !== 0) return false;

  // Must be a multi-label FQDN. Blocks single-label names and numeric/encoded
  // IP forms with no dot (e.g. decimal "2130706433", hex "0x7f000001").
  if (!host.includes(".")) return false;

  // Must contain a letter — a real hostname does; an all-numeric dotted form
  // (a raw IPv4 that slipped past net.isIP, or "3.14.15") does not.
  if (!/[a-z]/.test(host)) return false;

  // Explicit internal/non-routable suffixes.
  if (
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".localhost")
  ) {
    return false;
  }

  return true;
}

function isUnsafeResolvedIp(address: string): boolean {
  if (net.isIP(address) === 4) {
    const parts = address.split(".").map((part) => Number.parseInt(part, 10));
    const [a, b] = parts;
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 0) return true;
    if (a >= 224) return true;
    return false;
  }

  if (net.isIP(address) === 6) {
    const normalized = address.toLowerCase();
    if (normalized === "::1" || normalized === "::") return true;
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
    if (normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) return true;
    if (normalized.startsWith("::ffff:")) return isUnsafeResolvedIp(normalized.slice("::ffff:".length));
    return false;
  }

  return true;
}

export async function isSafePushEndpointResolved(endpoint: string): Promise<boolean> {
  if (!isSafePushEndpoint(endpoint)) return false;

  const url = new URL(endpoint);
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.+$/, "").toLowerCase();
  try {
    const addresses = await lookup(host, { all: true, verbatim: true });
    return addresses.length > 0 && addresses.every(({ address }) => !isUnsafeResolvedIp(address));
  } catch {
    return false;
  }
}
