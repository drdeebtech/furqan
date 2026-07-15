/**
 * Guardian link-code matching (audit AUTHZ-VULN-01).
 *
 * A guardian must supply the student's out-of-band link code (plus the email)
 * to create a guardian_children link — knowing the email alone is no longer
 * enough. Kept as a tiny pure helper so the security-critical comparison is
 * unit-testable without standing up Supabase.
 */
import { safeCompareSecret } from "@/lib/security/secrets";

/** Trim + uppercase so the human-shared code matches regardless of casing/spaces. */
export function normalizeGuardianCode(code: string): string {
  return code.trim().toUpperCase();
}

/**
 * True only when `stored` is a non-empty code that equals `submitted`.
 * Fail-closed: a null/absent stored code (e.g. column not yet backfilled, or a
 * profile that never generated one) never matches.
 */
export function guardianCodeMatches(
  stored: string | null | undefined,
  submitted: string,
): boolean {
  if (!stored) return false;
  const normalizedSubmitted = normalizeGuardianCode(submitted);
  if (normalizedSubmitted.length === 0) return false;
  return safeCompareSecret(normalizeGuardianCode(stored), normalizedSubmitted);
}
