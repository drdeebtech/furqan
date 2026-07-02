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

/** Serialize/parse the consent cookie value ("<version>:<method>"). */
export function encodeConsentCookie(method: ConsentMethod): string {
  return `${TERMS_VERSION}:${method}`;
}

export function parseConsentCookie(value: string | undefined): ConsentRecord | null {
  if (!value) return null;
  const [version, method] = value.split(":");
  if (!version || (method !== "checkbox" && method !== "notice")) return null;
  return { version, accepted_at: new Date().toISOString(), method };
}
