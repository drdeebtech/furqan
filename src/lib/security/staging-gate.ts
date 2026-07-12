/**
 * Staging access gate (HTTP Basic Auth).
 *
 * Active ONLY when the STAGING_PASSWORD env var is set — it is set solely on
 * the furqan-staging Vercel project, so production and local dev never see
 * the prompt. The Vercel plan can't put Vercel Authentication in front of
 * this project's production deployments (staging.furqan.today targets
 * production there), so the app enforces its own gate at the proxy entry.
 *
 * /api/* routes never reach this check (excluded by the proxy matcher) and
 * keep their own machine auth (Stripe signatures, CRON_SECRET, sessions).
 */

/** Constant-time comparison — no early exit that leaks a matching prefix via timing. */
function timingSafeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < len; i++) {
    // charCodeAt past the end is NaN; bitwise ops coerce NaN to 0.
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * True when the request's Authorization header carries the staging password.
 * The Basic-auth username is ignored — only the part after the first ":"
 * (the password field in every browser prompt) is compared.
 */
export function isAuthorizedForStaging(
  authorizationHeader: string | null,
  password: string,
): boolean {
  if (!authorizationHeader?.startsWith("Basic ")) return false;
  let decoded: string;
  try {
    decoded = atob(authorizationHeader.slice("Basic ".length).trim());
  } catch {
    return false;
  }
  const supplied = decoded.slice(decoded.indexOf(":") + 1);
  return timingSafeEqual(supplied, password);
}
