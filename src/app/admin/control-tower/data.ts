import "server-only";
import { createClient } from "@/lib/supabase/server";
import { countOrFail } from "@/lib/supabase/load-or-fail";

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
 * Single source of truth for control-tower widget counts. Used by the page
 * for SSR and by `/api/admin/control-tower/snapshot` for the 30s polling
 * refresh. RLS-scoped via the user-cookie client; the snapshot route also
 * gates with `requireAdminForApi` for defense in depth.
 */
export async function loadControlTowerSnapshot(): Promise<ControlTowerSnapshot> {
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

  return {
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
}
