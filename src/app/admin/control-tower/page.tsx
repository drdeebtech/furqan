import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Activity, AlertTriangle, BookOpen, Clock, Package, Timer, TrendingDown, Users, XCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "مركز التحكم" };

export default async function ControlTowerPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single<{ role: string }>();
  if (!profile || profile.role !== "admin") redirect("/login");

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
  ] = await Promise.all([
    supabase.from("teacher_profiles").select("id", { count: "exact", head: true }).eq("cv_status", "pending_review"),
    supabase.from("automation_logs").select("id", { count: "exact", head: true }).eq("status", "failed").gte("started_at", dayAgo),
    supabase.from("bookings").select("id", { count: "exact", head: true }).eq("status", "no_show").gte("scheduled_at", todayStart),
    supabase.from("profiles").select("id", { count: "exact", head: true }).gte("created_at", weekAgo),
    supabase.from("homework_assignments").select("id", { count: "exact", head: true }).eq("status", "student_ready"),
    supabase.from("recitation_errors").select("id", { count: "exact", head: true }).eq("resolved", false),
    supabase.from("sessions").select("id", { count: "exact", head: true }).is("ended_at", null).not("started_at", "is", null).lt("started_at", fifteenMinAgo),
    supabase.from("automation_dead_letter").select("id", { count: "exact", head: true }).is("resolved_at", null),
  ]);

  const { count: atRiskCount } = await supabase
    .from("retention_signals")
    .select("student_id", { count: "exact", head: true })
    .gte("churn_risk_score", 60);

  // Low balance packages — fetch only the fields needed, limit to active
  const { data: lowPkgs } = await supabase
    .from("student_packages")
    .select("sessions_total, sessions_used, expires_at")
    .eq("status", "active")
    .returns<{ sessions_total: number; sessions_used: number; expires_at: string | null }[]>();
  const lowBalanceCount = (lowPkgs ?? []).filter(p => (p.sessions_total - p.sessions_used) <= 2).length;

  const widgets = [
    { label: "سير ذاتية بانتظار المراجعة", en: "Pending CVs", value: pendingCvRes.count ?? 0, icon: Users, color: "text-amber-400", bg: "bg-amber-500/10", href: "/admin/teachers/cv", threshold: 0 },
    { label: "أتمتة فاشلة (24 ساعة)", en: "Failed Automations", value: failedAutoRes.count ?? 0, icon: XCircle, color: "text-red-400", bg: "bg-red-500/10", href: "/admin/automation", threshold: 0 },
    { label: "مهام فاشلة نهائياً", en: "Dead-Letter Queue", value: deadLetterRes.count ?? 0, icon: XCircle, color: "text-red-500", bg: "bg-red-500/15", href: "/admin/automation", threshold: 0 },
    { label: "جلسات متوقفة", en: "Stuck Sessions (>15m)", value: stuckSessionsRes.count ?? 0, icon: Timer, color: "text-red-400", bg: "bg-red-500/10", href: "/admin/sessions/live", threshold: 0 },
    { label: "غياب اليوم", en: "No-Shows Today", value: noShowTodayRes.count ?? 0, icon: AlertTriangle, color: "text-orange-400", bg: "bg-orange-500/10", href: "/admin/sessions", threshold: 0 },
    { label: "باقات منخفضة الرصيد", en: "Low Balance Packages", value: lowBalanceCount, icon: Package, color: "text-sky-400", bg: "bg-sky-500/10", href: "/admin/credits", threshold: 0 },
    { label: "مسجلون جدد (7 أيام)", en: "New Signups", value: newSignupsRes.count ?? 0, icon: Users, color: "text-emerald-400", bg: "bg-emerald-500/10", href: "/admin/users", threshold: -1 },
    { label: "طلاب في خطر التسرب", en: "At-Risk Students", value: atRiskCount ?? 0, icon: TrendingDown, color: "text-rose-400", bg: "bg-rose-500/10", href: "/admin/retention", threshold: 0 },
    { label: "واجبات بانتظار التقييم", en: "Pending Grading", value: pendingGradingRes.count ?? 0, icon: BookOpen, color: "text-purple-400", bg: "bg-purple-500/10", href: "/admin/notes", threshold: 0 },
    { label: "أخطاء تلاوة غير محلولة", en: "Unresolved Errors", value: unresolvedErrorsRes.count ?? 0, icon: AlertTriangle, color: "text-amber-400", bg: "bg-amber-500/10", href: "/admin/sessions", threshold: 10 },
  ];

  const alertCount = widgets.filter(w => w.threshold >= 0 && w.value > w.threshold).length;

  return (
    <div dir="rtl" className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Activity size={24} className="text-gold" />
          <h1 className="text-xl font-bold">مركز التحكم</h1>
        </div>
        {alertCount > 0 && (
          <span className="rounded-full bg-red-500/10 px-3 py-1 text-sm font-bold text-red-400">
            {alertCount} تنبيهات
          </span>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {widgets.map(w => {
          const Icon = w.icon;
          const isAlert = w.threshold >= 0 && w.value > w.threshold;
          return (
            <Link key={w.label} href={w.href} className={`glass-card flex items-center gap-4 p-5 transition-colors hover:border-gold/20 ${isAlert ? "border-red-500/20" : ""}`}>
              <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${w.bg}`}>
                <Icon size={22} className={w.color} />
              </div>
              <div>
                <p className="font-display text-2xl font-bold">{w.value}</p>
                <p className="text-xs text-muted">{w.label}</p>
              </div>
              {isAlert && <AlertTriangle size={14} className="mr-auto text-red-400" />}
            </Link>
          );
        })}
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Link href="/admin/automation" className="glass-card p-4 text-center transition-colors hover:border-gold/20">
          <p className="text-sm font-medium">سجل الأتمتة</p>
        </Link>
        <Link href="/admin/audit" className="glass-card p-4 text-center transition-colors hover:border-gold/20">
          <p className="text-sm font-medium">سجل المراجعة</p>
        </Link>
      </div>
    </div>
  );
}
