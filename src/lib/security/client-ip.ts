/**
 * Resolve the originating client IP from request headers — but only when a
 * trusted proxy vouches for them (issue #691).
 *
 * Trust model:
 * - On Vercel (`VERCEL` env set) the edge overwrites `x-forwarded-for` and
 *   `x-real-ip`, so they are authoritative and cannot be spoofed to forge a
 *   fresh per-IP rate-limit bucket.
 * - Anywhere else the headers are client-controlled bytes: honoring them
 *   would let one attacker mint unlimited per-IP buckets. Without explicit
 *   trusted-proxy configuration we return null (fail-safe: per-IP limiters
 *   fall back to their per-email/shared-bucket backstops).
 *
 * Returns null when no trustworthy IP can be derived; callers apply their own
 * fallback (`?? "unknown"` for a rate-limit key, `?? null` for an audit record).
 */
type ClientIpEnv = {
  VERCEL?: string;
  TRUSTED_PROXY_HOPS?: string;
  // Index signature so process.env (NodeJS.ProcessEnv) stays assignable.
  [key: string]: string | undefined;
};
export function getClientIp(
  requestHeaders: Headers,
  env: ClientIpEnv = process.env,
): string | null {
  if (env.VERCEL) {
    return (
      requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      requestHeaders.get("x-real-ip")?.trim() ||
      null
    );
  }

  // Self-hosted behind N declared trusted proxies: each trusted hop appended
  // one entry to x-forwarded-for, so the real client is the Nth entry from
  // the right. Anything left of that is client-supplied and ignored.
  const hops = Number(env.TRUSTED_PROXY_HOPS);
  if (Number.isInteger(hops) && hops >= 1) {
    const chain = requestHeaders
      .get("x-forwarded-for")
      ?.split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    return chain?.[chain.length - hops] ?? null;
  }

  return null;
}
