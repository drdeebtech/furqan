/**
 * Shared guard for e2e specs that CREATE data (sign up users, seed rows).
 *
 * Two traps this closes, both hit for real while writing the booking-paywall
 * spec:
 *
 *  1. WRONG PROJECT. `.env.local` carries BOTH `SUPABASE_URL` (the hosted
 *     project) and `NEXT_PUBLIC_SUPABASE_URL` (the local stack the dev server
 *     actually talks to). A spec that resolves `SUPABASE_URL ?? NEXT_PUBLIC_...`
 *     seeds one database while the page under test reads another — and the
 *     database it seeds is real. Always resolve the URL the APP reads.
 *
 *  2. NO SAFETY NET. Nothing else stops a write-capable spec from running
 *     against a remote project; it is one env edit or one matching key away.
 *     `hasLocalSupabaseEnv()` requires a loopback host, so such a spec SKIPS
 *     instead of writing to something real.
 *
 * Read-only specs that intentionally target a provisioned project (e.g.
 * daily-webhook-reconciliation, teacher-progress-capture, student-booking-flow,
 * which need pre-seeded ids) deliberately do NOT use this and keep reading
 * `SUPABASE_URL`.
 */

/** The Supabase URL the running app itself uses. Never the hosted fallback. */
export const APP_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
export const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/** True only for a loopback host — the one place a spec may create data. */
export function isLoopbackSupabase(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
  } catch {
    return false;
  }
}

/**
 * Gate for write-capable specs: all three creds present AND pointed at a local
 * stack. Use as `test.skip(!hasLocalSupabaseEnv(), LOCAL_ONLY_SKIP_REASON)`.
 */
export function hasLocalSupabaseEnv(): boolean {
  return (
    !!APP_SUPABASE_URL &&
    !!SERVICE_ROLE_KEY &&
    !!ANON_KEY &&
    isLoopbackSupabase(APP_SUPABASE_URL)
  );
}

export const LOCAL_ONLY_SKIP_REASON =
  "requires a LOOPBACK NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + " +
  "NEXT_PUBLIC_SUPABASE_ANON_KEY — this spec creates users and seeds rows, so " +
  "it never runs against a remote project";
