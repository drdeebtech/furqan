import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/logger";

/**
 * Per-IP rate limit using the `automation_logs` table as a counter.
 *
 * Each call counts rows with a given `workflow_name` + `payload_json->>ip`
 * in the last hour; if under the cap it inserts a fresh row (the "attempt"
 * ledger) and returns true, otherwise returns false. Defence-in-depth that
 * does NOT depend on the Vercel BotID/OIDC gate — so it still works on
 * self-hosted / CI / staging where BotID is bypassed or throws.
 *
 * Fail-open: a transient `automation_logs` outage never blocks a real
 * submission (the caller logs and admits). This matches the original
 * `checkApplyRate` behaviour.
 *
 * Mirrors the pattern first introduced in teach-with-us/apply/actions.ts
 * (MAX_APPLICATIONS_PER_HOUR); extracted here so every anonymous public
 * action (teacher application, contact form, …) shares one counter rule.
 */
export async function checkRateLimit(
  ipKey: string,
  workflow: string,
  maxPerHour: number,
): Promise<boolean> {
  try {
    const supabase = createAdminClient();
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    // `automation_logs.entity_id` is a UUID column. Storing the raw IP string
    // there caused Postgres 22P02 (`invalid input syntax for type uuid`) on
    // every apply (JAVASCRIPT-NEXTJS-E4-25/26/29 in Sentry). The IP lives in
    // `payload_json` (jsonb) instead; `entity_id` stays NULL. The IP is
    // rate-limit metadata, not a domain entity.
    const { count } = await supabase
      .from("automation_logs")
      .select("id", { count: "exact", head: true })
      .eq("workflow_name", workflow)
      .eq("payload_json->>ip", ipKey)
      .gte("started_at", oneHourAgo);

    if ((count ?? 0) >= maxPerHour) return false;

    const now = new Date().toISOString();
    const { error: autoLogError } = await supabase.from("automation_logs").insert({
      workflow_name: workflow,
      entity_type: "ip",
      entity_id: null,
      payload_json: { ip: ipKey },
      status: "succeeded",
      started_at: now,
      finished_at: now,
    });
    if (autoLogError) {
      logError(`rate-limit log insert failed (${workflow})`, autoLogError, { tag: workflow });
    }
    return true;
  } catch (err) {
    // Fail open — never block a real submission because the rate-limit table is down.
    logError(`rate-limit check failed — allowing (${workflow})`, err, { tag: workflow });
    return true;
  }
}
