import "server-only";
import { createClient } from "@/lib/supabase/server";

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

  return {
    generatedAt: new Date().toISOString(),
    counts: {
      "pending-cvs": pendingCvRes.count ?? 0,
      "failed-auto": failedAutoRes.count ?? 0,
      "dead-letter": deadLetterRes.count ?? 0,
      stuck: stuckSessionsRes.count ?? 0,
      "no-show": noShowTodayRes.count ?? 0,
      "low-balance": lowBalanceRes.count ?? 0,
      "new-signups": newSignupsRes.count ?? 0,
      "at-risk": atRiskRes.count ?? 0,
      grading: pendingGradingRes.count ?? 0,
      recitation: unresolvedErrorsRes.count ?? 0,
      "failed-actions": failedActionsRes.count ?? 0,
    },
  };
}
