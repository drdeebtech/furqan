import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/logger";
import { withTimeout } from "@/lib/promise-utils";

// A hung limiter RPC must not stall credential routes: bound it and treat a
// timeout exactly like a backend error (deny on fail-closed routes). Well
// above a healthy RPC (~30ms), well below a user-visible hang.
const RATE_LIMIT_RPC_TIMEOUT_MS = 3000;

/**
 * Per-identifier rate limit backed by the atomic
 * `check_and_increment_rate_limit` RPC (`rate_limits` table,
 * `INSERT ... ON CONFLICT DO UPDATE ... RETURNING count`) — one statement, so
 * concurrent bursts can't each read a sub-cap count and all slip through
 * (issue #688; replaces the old two-step count-then-insert on
 * `automation_logs`). Fixed one-hour window. Blocked attempts still increment
 * the counter, so post-cap hammering stays visible in the ledger.
 *
 * Defence-in-depth that does NOT depend on the Vercel BotID/OIDC gate — so it
 * still works on self-hosted / CI / staging where BotID is bypassed or throws.
 *
 * Fail-open by default: a transient limiter outage never blocks a real
 * submission on public forms (contact, teacher application). Pass
 * `{ failClosed: true }` for credential and capability-token routes
 * (login/register/forgot-password, parent portal) where a limiter backend
 * error must DENY rather than admit — the guard is only meaningful if it
 * can't be bypassed by knocking the counter table over.
 */
export async function checkRateLimit(
  ipKey: string,
  workflow: string,
  maxPerHour: number,
  opts?: { failClosed?: boolean },
): Promise<boolean> {
  const failClosed = opts?.failClosed ?? false;
  try {
    // admin: the RPC is granted to service_role only; callers are
    // pre-authentication so the SSR client can't execute it (issue #523).
    const supabase = createAdminClient();
    const { data: allowed, error } = await withTimeout<{
      data: boolean | null;
      error: { message: string } | null;
    }>(
      supabase.rpc("check_and_increment_rate_limit", {
        p_bucket: workflow,
        p_identifier: ipKey,
        p_max: maxPerHour,
        p_window_seconds: 3600,
      }),
      RATE_LIMIT_RPC_TIMEOUT_MS,
      {
        data: null,
        error: { message: `rate-limit rpc timed out or rejected (${RATE_LIMIT_RPC_TIMEOUT_MS}ms cap)` },
      },
      `rate-limit-rpc:${workflow}`,
    );
    // Error OR malformed payload: both are "limiter unavailable" — the
    // route's declared policy decides (fail-closed denies, public forms
    // stay fail-open). Never treat an unknown state as a verdict.
    if (error || typeof allowed !== "boolean") {
      logError(
        `rate-limit rpc ${error ? "failed" : "returned non-boolean"} — ${failClosed ? "denying" : "allowing"} (${workflow})`,
        error ?? new Error(`unexpected rpc payload: ${String(allowed)}`),
        { tag: workflow },
      );
      return !failClosed;
    }
    return allowed;
  } catch (err) {
    // Fail-closed routes deny on backend error; everyone else fails open so a
    // limiter outage never blocks a real submission.
    logError(
      `rate-limit check failed — ${failClosed ? "denying" : "allowing"} (${workflow})`,
      err,
      { tag: workflow },
    );
    return !failClosed;
  }
}
