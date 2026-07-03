/**
 * Legal/consent constants shared by both signup paths (email form + Google OAuth).
 *
 * TERMS_VERSION identifies WHICH terms/privacy text the user agreed to.
 * Bump it whenever /terms or /privacy change materially; consent records
 * store the version so we can prove what was on screen at acceptance time.
 */
export const TERMS_VERSION = "2026-04-23";

/** Cookie carrying consent through the OAuth redirect round-trip. */
export const CONSENT_COOKIE = "furqan-consent";

/** How the user expressed consent. `checkbox` = explicit clickwrap on /register;
 *  `notice` = continue-implies-agreement notice next to the Google button on /login. */
export type ConsentMethod = "checkbox" | "notice";

export interface ConsentRecord {
  version: string;
  accepted_at: string;
  method: ConsentMethod;
}

export function buildConsentRecord(method: ConsentMethod): ConsentRecord {
  return { version: TERMS_VERSION, accepted_at: new Date().toISOString(), method };
}

/** Serialize/parse the consent cookie value ("<version>:<method>:<epoch-ms>").
 *  The timestamp is stamped at click time and carried through the OAuth
 *  round-trip so the recorded `accepted_at` reflects when the user actually
 *  consented, not when the callback happens to process it. */
export function encodeConsentCookie(method: ConsentMethod): string {
  return `${TERMS_VERSION}:${method}:${Date.now()}`;
}

export function parseConsentCookie(value: string | undefined): ConsentRecord | null {
  if (!value) return null;
  const [version, method, ts] = value.split(":");
  // The cookie is client-writeable, so treat it as untrusted: only accept the
  // terms version we currently serve (the gated buttons always encode
  // TERMS_VERSION and the cookie lives ~10min), and a known method. This keeps
  // arbitrary/stale versions out of the tamper-resistant app_metadata record.
  if (version !== TERMS_VERSION) return null;
  if (method !== "checkbox" && method !== "notice") return null;
  // Use the click-time stamp when present and sane; older cookies (no ts) or a
  // tampered value fall back to now rather than fabricating a lie. The cookie
  // is client-writeable and lives ~10min, so bound the stamp to a plausible
  // window: reject the future (small clock skew allowed) and anything older
  // than an hour. This also keeps out-of-Date-range values from throwing in
  // toISOString().
  const now = Date.now();
  const parsedTs = ts ? Number(ts) : NaN;
  const isSaneTs =
    Number.isFinite(parsedTs) &&
    parsedTs <= now + 5 * 60_000 &&
    parsedTs >= now - 60 * 60_000;
  const accepted_at = new Date(isSaneTs ? parsedTs : now).toISOString();
  return { version, accepted_at, method };
}
