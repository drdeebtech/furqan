import net from "node:net";

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
 * ponytail: hostname-based, no DNS resolution — it cannot stop a public name
 * that later resolves to a private IP (DNS rebinding). Full protection needs a
 * resolve-then-pin check or an SSRF-safe HTTP agent inside web-push; upgrade
 * there if the threat model warrants. Given the push body is encrypted and the
 * channel is blind, closing the IP-literal hole is the high-value fix.
 */
export function isSafePushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }

  if (url.protocol !== "https:") return false;

  // new URL keeps IPv6 literals bracketed ("[::1]"); strip for net.isIP.
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();

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
