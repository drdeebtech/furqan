import type { Metadata } from "next";
import Link from "next/link";
import { Activity, AlertTriangle, BookOpen, Package, Timer, TrendingDown, Users, XCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "مركز التحكم" };

export default async function ControlTowerPage() {
  const { t, dir, lang } = await getT();
  const supabase = await createClient();

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  // Stuck sessions: scheduled_at + duration_min has passed, session started (started_at set)
  // but ended_at is null. Grace window 15 min, filter client-side to avoid complex SQL.
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
    // v14_008 added sessions_remaining as a STORED generated column with a
    // partial index covering active + remaining<=2 — filter is now fully
    // server-side via head:true count.
    supabase.from("student_packages").select("id", { count: "exact", head: true }).eq("status", "active").lte("sessions_remaining", 2),
  ]);

  const { count: failedActionsCount } = await supabase
    .from("audit_log")
    .select("id", { count: "exact", head: true })
    .ilike("reason", "%FAILED%")
    .gte("created_at", dayAgo);

  const atRiskCount = atRiskRes.count;
  const lowBalanceCount = lowBalanceRes.count ?? 0;

  // Severity tiers — every widget routes through the same three tokens
  // (warning, error, success/info). Direct Tailwind palette classes were
  // bypassing globals.css tokens and would not adapt to light mode.
  type Tier = "warning" | "error" | "info" | "success";
  const TIER_FG: Record<Tier, string> = {
    warning: "text-warning",
    error: "text-error",
    info: "text-gold",
    success: "text-success",
  };
  const TIER_BG: Record<Tier, string> = {
    warning: "bg-warning/10",
    error: "bg-error/10",
    info: "bg-gold/10",
    success: "bg-success/10",
  };

  const widgets: { key: string; label: string; value: number; icon: typeof Users; tier: Tier; href: string; threshold: number }[] = [
    { key: "pending-cvs", label: t("سير ذاتية بانتظار المراجعة", "Pending CVs"), value: pendingCvRes.count ?? 0, icon: Users, tier: "warning", href: "/admin/teachers/cv", threshold: 0 },
    { key: "failed-auto", label: t("أتمتة فاشلة (24 ساعة)", "Failed Automations (24h)"), value: failedAutoRes.count ?? 0, icon: XCircle, tier: "error", href: "/admin/automation", threshold: 0 },
    { key: "dead-letter", label: t("مهام فاشلة نهائياً", "Dead-Letter Queue"), value: deadLetterRes.count ?? 0, icon: XCircle, tier: "error", href: "/admin/automation", threshold: 0 },
    { key: "stuck", label: t("جلسات متوقفة", "Stuck Sessions (>15m)"), value: stuckSessionsRes.count ?? 0, icon: Timer, tier: "error", href: "/admin/sessions/live", threshold: 0 },
    { key: "no-show", label: t("غياب اليوم", "No-Shows Today"), value: noShowTodayRes.count ?? 0, icon: AlertTriangle, tier: "warning", href: "/admin/sessions", threshold: 0 },
    { key: "low-balance", label: t("باقات منخفضة الرصيد", "Low Balance Packages"), value: lowBalanceCount, icon: Package, tier: "info", href: "/admin/credits", threshold: 0 },
    { key: "new-signups", label: t("مسجلون جدد (7 أيام)", "New Signups (7d)"), value: newSignupsRes.count ?? 0, icon: Users, tier: "success", href: "/admin/users", threshold: -1 },
    { key: "at-risk", label: t("طلاب في خطر التسرب", "At-Risk Students"), value: atRiskCount ?? 0, icon: TrendingDown, tier: "error", href: "/admin/retention", threshold: 0 },
    { key: "grading", label: t("واجبات بانتظار التقييم", "Pending Grading"), value: pendingGradingRes.count ?? 0, icon: BookOpen, tier: "info", href: "/admin/notes", threshold: 0 },
    { key: "recitation", label: t("أخطاء تلاوة غير محلولة", "Unresolved Errors"), value: unresolvedErrorsRes.count ?? 0, icon: AlertTriangle, tier: "warning", href: "/admin/sessions", threshold: 10 },
    { key: "failed-actions", label: t("إجراءات إدارية فاشلة (24 ساعة)", "Failed Admin Actions (24h)"), value: failedActionsCount ?? 0, icon: XCircle, tier: "error", href: "/admin/audit", threshold: 0 },
  ];

  const alertCount = widgets.filter(w => w.threshold >= 0 && w.value > w.threshold).length;

  return (
    <div dir={dir} className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Activity size={24} className="text-gold" aria-hidden="true" />
          <h1 className="font-display text-2xl font-bold sm:text-3xl">{t("مركز التحكم", "Control Tower")}</h1>
        </div>
        {alertCount > 0 && (
          <span className="rounded-full bg-error/10 px-3 py-1 text-sm font-bold text-error">
            {lang === "ar" ? `${alertCount} تنبيهات` : `${alertCount} alerts`}
          </span>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {widgets.map(w => {
          const Icon = w.icon;
          const isAlert = w.threshold >= 0 && w.value > w.threshold;
          return (
            <Link key={w.key} href={w.href} className={`glass-card flex items-center gap-4 p-5 transition-colors hover:border-gold/30 ${isAlert ? "border-error/30" : ""}`}>
              <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${TIER_BG[w.tier]}`}>
                <Icon size={22} className={TIER_FG[w.tier]} aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-display text-2xl font-bold tabular-nums">{w.value}</p>
                <p className="text-xs text-muted">{w.label}</p>
              </div>
              {isAlert && <AlertTriangle size={14} className="text-error" aria-hidden="true" />}
            </Link>
          );
        })}
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Link href="/admin/automation" className="glass-card p-4 text-center transition-colors hover:border-gold/20">
          <p className="text-sm font-medium">{t("سجل الأتمتة", "Automation Logs")}</p>
        </Link>
        <Link href="/admin/audit" className="glass-card p-4 text-center transition-colors hover:border-gold/20">
          <p className="text-sm font-medium">{t("سجل المراجعة", "Audit Log")}</p>
        </Link>
      </div>
    </div>
  );
}
