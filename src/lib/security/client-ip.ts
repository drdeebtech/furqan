/**
 * Resolve the originating client IP from request headers.
 *
 * Trust model: this app runs behind Vercel's edge, which sets `x-forwarded-for`
 * (leftmost entry = the real client) and `x-real-ip`, and overwrites any
 * client-supplied values at the edge — so on Vercel these headers are
 * authoritative and cannot be spoofed to forge a fresh per-IP rate-limit bucket.
 *
 * Off Vercel (self-hosted behind an untrusted multi-hop proxy) neither header is
 * trustworthy on its own; if this app is ever deployed that way, key rate limits
 * off the trusted proxy's connection IP instead. Centralizing the extraction
 * here keeps that single assumption in one auditable place rather than duplicated
 * across every public action and auth route.
 *
 * Returns null when no IP header is present; callers apply their own fallback
 * (e.g. `?? "unknown"` for a rate-limit key, `?? null` for an audit record).
 */
export function getClientIp(requestHeaders: Headers): string | null {
  return (
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    requestHeaders.get("x-real-ip")?.trim() ||
    null
  );
}
