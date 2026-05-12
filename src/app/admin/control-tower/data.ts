import "server-only";
import { getCache } from "@vercel/functions";
import { createClient } from "@/lib/supabase/server";
import { countOrFail } from "@/lib/supabase/load-or-fail";
import { logWarn } from "@/lib/logger";

export type WidgetTier = "warning" | "error" | "info" | "success";
export type WidgetKey =
  | "pending-cvs"
  | "failed-auto"
  | "dead-letter"
  | "stuck"
  | "no-show"
  | "low-balance"
  | "new-signups"
  | "at-risk"
  | "grading"
  | "recitation"
  | "failed-actions";

export type ControlTowerSnapshot = {
  generatedAt: string;
  counts: Record<WidgetKey, number>;
  /** True if any of the 11 count queries returned an error. */
  anyFailed: boolean;
};

/**
 * Cache key + TTL for the snapshot in the Vercel Runtime Cache. The
 * counts don't depend on the viewing admin (every admin sees the same
 * platform-wide metrics), so a single shared cache entry per region is
 * correct. TTL deliberately matches the page's 30 s polling cadence —
 * a slower poll reads from cache, a refresh-burst doesn't pile up
 * 11-query thundering herds against Postgres.
 */
const CONTROL_TOWER_CACHE_KEY = "admin-control-tower-snapshot";
const CONTROL_TOWER_TTL_SECONDS = 30;
const CONTROL_TOWER_TAG = "admin-tower";

/**
 * Single source of truth for control-tower widget counts. Used by the page
 * for SSR and by `/api/admin/control-tower/snapshot` for the 30s polling
 * refresh. RLS-scoped via the user-cookie client; the snapshot route also
 * gates with `requireAdminForApi` for defense in depth.
 *
 * The 11-query Promise.all is wrapped in Vercel Runtime Cache (per-region,
 * shared across admins) — a 30 s warm window means most polling refreshes
 * skip Postgres entirely. Failed snapshots (anyFailed=true) are NOT cached
 * so the next request retries fresh. Non-Vercel runtimes (local dev) are
 * tolerated — getCache() throws are swallowed and the call falls through
 * to a direct DB read.
 */
export async function loadControlTowerSnapshot(): Promise<ControlTowerSnapshot> {
  // Cache read — best-effort; never blocks the snapshot if the runtime
  // cache is unavailable (local dev, transient regional issue, etc).
  try {
    const cached = (await getCache().get(CONTROL_TOWER_CACHE_KEY)) as
      | ControlTowerSnapshot
      | undefined
      | null;
    if (cached) return cached;
  } catch (err) {
    // Tolerate runtime-cache outages but surface them as warnings so
    // persistent cache problems are visible in Sentry → Logs.
    logWarn("control-tower cache read failed; falling through to DB", {
      tag: "control-tower", kind: "cache-read", error: err instanceof Error ? err.message : String(err),
    });
  }

  const supabase = await createClient();
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const fifteenMinAgo = new Date(now.getTime() - 15 * 60 * 1000).toISOString();

  const [
    pendingCvRes,
    failedAutoRes,
    noShowTodayRes,
    newSignupsRes,
    pendingGradingRes,
    unresolvedErrorsRes,
    stuckSessionsRes,
    deadLetterRes,
    atRiskRes,
    lowBalanceRes,
    failedActionsRes,
  ] = await Promise.all([
    supabase.from("teacher_profiles").select("id", { count: "exact", head: true }).eq("cv_status", "pending_review"),
    supabase.from("automation_logs").select("id", { count: "exact", head: true }).eq("status", "failed").gte("started_at", dayAgo),
    supabase.from("bookings").select("id", { count: "exact", head: true }).eq("status", "no_show").gte("scheduled_at", todayStart),
    supabase.from("profiles").select("id", { count: "exact", head: true }).gte("created_at", weekAgo),
    supabase.from("homework_assignments").select("id", { count: "exact", head: true }).eq("status", "student_ready"),
    supabase.from("recitation_errors").select("id", { count: "exact", head: true }).eq("resolved", false),
    supabase.from("sessions").select("id", { count: "exact", head: true }).is("ended_at", null).not("started_at", "is", null).lt("started_at", fifteenMinAgo),
    supabase.from("automation_dead_letter").select("id", { count: "exact", head: true }).is("resolved_at", null),
    supabase.from("retention_signals").select("student_id", { count: "exact", head: true }).gte("churn_risk_score", 60),
    supabase.from("student_packages").select("id", { count: "exact", head: true }).eq("status", "active").lte("sessions_remaining", 2),
    supabase.from("audit_log").select("id", { count: "exact", head: true }).ilike("reason", "%FAILED%").gte("created_at", dayAgo),
  ]);

  // countOrFail logs each failure to Sentry with a widget-specific tag,
  // returns 0 on failure, and exposes a per-query `failed` flag we OR
  // together for the banner. A 0-displayed widget is now legibly
  // distinct from a failed widget in Sentry but still safe in the UI
  // (the count just reads 0 and the banner explains).
  const widgets = [
    countOrFail(pendingCvRes, { route: "admin-control-tower", widget: "pending-cvs" }),
    countOrFail(failedAutoRes, { route: "admin-control-tower", widget: "failed-auto" }),
    countOrFail(noShowTodayRes, { route: "admin-control-tower", widget: "no-show" }),
    countOrFail(newSignupsRes, { route: "admin-control-tower", widget: "new-signups" }),
    countOrFail(pendingGradingRes, { route: "admin-control-tower", widget: "grading" }),
    countOrFail(unresolvedErrorsRes, { route: "admin-control-tower", widget: "recitation" }),
    countOrFail(stuckSessionsRes, { route: "admin-control-tower", widget: "stuck" }),
    countOrFail(deadLetterRes, { route: "admin-control-tower", widget: "dead-letter" }),
    countOrFail(atRiskRes, { route: "admin-control-tower", widget: "at-risk" }),
    countOrFail(lowBalanceRes, { route: "admin-control-tower", widget: "low-balance" }),
    countOrFail(failedActionsRes, { route: "admin-control-tower", widget: "failed-actions" }),
  ];

  const snapshot: ControlTowerSnapshot = {
    generatedAt: new Date().toISOString(),
    anyFailed: widgets.some(w => w.failed),
    counts: {
      "pending-cvs": widgets[0].count,
      "failed-auto": widgets[1].count,
      "no-show": widgets[2].count,
      "new-signups": widgets[3].count,
      grading: widgets[4].count,
      recitation: widgets[5].count,
      stuck: widgets[6].count,
      "dead-letter": widgets[7].count,
      "at-risk": widgets[8].count,
      "low-balance": widgets[9].count,
      "failed-actions": widgets[10].count,
    },
  };

  // Cache only successful snapshots — a partial-failure result would
  // serve stale "0"s for 30 s instead of retrying immediately, which is
  // the wrong UX for an ops dashboard. Tagged so a future expireTag
  // call (e.g. from CV approval) can punch through the TTL when an
  // admin needs immediate freshness.
  if (!snapshot.anyFailed) {
    try {
      await getCache().set(CONTROL_TOWER_CACHE_KEY, snapshot, {
        ttl: CONTROL_TOWER_TTL_SECONDS,
        tags: [CONTROL_TOWER_TAG],
        name: "admin/control-tower/snapshot",
      });
    } catch (err) {
      // Snapshot still returns fresh; warn so persistent write failures
      // (e.g. quota, regional outage) are visible.
      logWarn("control-tower cache write failed; snapshot still served", {
        tag: "control-tower", kind: "cache-write", error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return snapshot;
}

/**
 * Punch through the snapshot's 30 s TTL when an admin action makes an
 * immediate refresh worthwhile (e.g. approving a CV should drop the
 * `pending-cvs` count to 0 right away rather than waiting up to 30 s).
 * Best-effort — silently no-ops when the runtime cache is unavailable.
 *
 * Idempotent: calling expireTag with no matching cached entries is a
 * cheap no-op. Safe to call from any admin server action.
 */
export async function expireControlTowerSnapshot(): Promise<void> {
  try {
    await getCache().expireTag(CONTROL_TOWER_TAG);
  } catch (err) {
    logWarn("control-tower expireTag failed; next read may serve stale snapshot", {
      tag: "control-tower", kind: "cache-expire", error: err instanceof Error ? err.message : String(err),
    });
  }
}
