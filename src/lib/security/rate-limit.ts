import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/logger";

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
    const { data: allowed, error } = await supabase.rpc("check_and_increment_rate_limit", {
      p_bucket: workflow,
      p_identifier: ipKey,
      p_max: maxPerHour,
      p_window_seconds: 3600,
    });
    if (error) {
      logError(
        `rate-limit rpc failed — ${failClosed ? "denying" : "allowing"} (${workflow})`,
        error,
        { tag: workflow },
      );
      return !failClosed;
    }
    return allowed === true;
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
