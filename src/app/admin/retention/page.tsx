import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, TrendingDown } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { riskTone, riskLabel } from "@/lib/retention/ui";
import { isFeatureDisabled } from "@/lib/settings";
import { InterventionButton } from "./intervention-button";
import { RunScorerButton } from "./run-scorer-button";
import { RetentionFilters } from "./filters";
import type { InterventionType } from "./actions";

type RiskFilter = "all" | "critical" | "high" | "medium" | "low";
type PkgFilter = "all" | "active" | "low" | "expiring" | "none";
type ContactedFilter = "all" | "never" | "recent" | "stale";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function applyFilters(rows: SignalRow[], f: { risk: RiskFilter; pkg: PkgFilter; contacted: ContactedFilter }): SignalRow[] {
  const now = Date.now();
  return rows.filter(r => {
    const risk = r.churn_risk_score ?? 0;
    if (f.risk === "critical" && risk < 75) return false;
    if (f.risk === "high" && (risk < 60 || risk >= 75)) return false;
    if (f.risk === "medium" && (risk < 40 || risk >= 60)) return false;
    if (f.risk === "low" && risk >= 40) return false;

    if (f.pkg === "active" && r.package_remaining == null) return false;
    if (f.pkg === "low" && (r.package_remaining == null || r.package_remaining > 2)) return false;
    if (f.pkg === "expiring") {
      if (!r.package_expires_at) return false;
      const delta = new Date(r.package_expires_at).getTime() - now;
      if (delta < 0 || delta > SEVEN_DAYS_MS) return false;
    }
    if (f.pkg === "none" && r.package_remaining != null) return false;

    if (f.contacted === "never" && r.last_intervention_at) return false;
    if (f.contacted === "recent" || f.contacted === "stale") {
      if (!r.last_intervention_at) return false;
      const age = now - new Date(r.last_intervention_at).getTime();
      if (f.contacted === "recent" && age >= SEVEN_DAYS_MS) return false;
      if (f.contacted === "stale" && age < SEVEN_DAYS_MS) return false;
    }

    return true;
  });
}

export const metadata: Metadata = { title: "إشارات البقاء" };

interface SignalRow {
  student_id: string;
  last_booking_at: string | null;
  last_session_at: string | null;
  package_remaining: number | null;
  package_expires_at: string | null;
  engagement_score: number | null;
  churn_risk_score: number | null;
  last_intervention_at: string | null;
  intervention_type: string | null;
  computed_at: string;
}

function daysAgo(iso: string | null): string {
  if (!iso) return "—";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000));
  if (days === 0) return "اليوم";
  if (days === 1) return "أمس";
  return `قبل ${days} يوم`;
}

function recommendedAction(s: SignalRow): { type: InterventionType; label: string } | null {
  const risk = s.churn_risk_score ?? 0;
  if (risk >= 75) return { type: "urgent_contact", label: "تواصل فوري" };
  if (s.package_remaining !== null && s.package_remaining <= 2) return { type: "renewal_offer", label: "عرض تجديد" };
  if (s.package_expires_at && new Date(s.package_expires_at).getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000) return { type: "expiry_reminder", label: "تذكير انتهاء" };
  if (!s.last_session_at || Date.now() - new Date(s.last_session_at).getTime() > 14 * 24 * 60 * 60 * 1000) return { type: "re_engagement", label: "إعادة تفعيل" };
  if (risk >= 60) return { type: "weekly_followup", label: "متابعة أسبوعية" };
  return null;
}

interface Props {
  searchParams: Promise<{ risk?: string; pkg?: string; contacted?: string }>;
}

export default async function RetentionPage({ searchParams }: Props) {
  const sp = await searchParams;
  const filters = {
    risk: (sp.risk as RiskFilter) ?? "all",
    pkg: (sp.pkg as PkgFilter) ?? "all",
    contacted: (sp.contacted as ContactedFilter) ?? "all",
  };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single<{ role: string }>();
  if (!profile || (profile.role !== "admin" && profile.role !== "moderator")) redirect("/login");

  if (await isFeatureDisabled("retention_ui_disabled")) redirect("/admin/dashboard");

  const { data: signals } = await supabase
    .from("retention_signals")
    .select("student_id, last_booking_at, last_session_at, package_remaining, package_expires_at, engagement_score, churn_risk_score, last_intervention_at, intervention_type, computed_at")
    .order("churn_risk_score", { ascending: false, nullsFirst: false })
    .limit(100)
    .returns<SignalRow[]>();

  const allSignals = signals ?? [];
  const rows = applyFilters(allSignals, filters);
  const studentIds = rows.map(r => r.student_id);

  const { data: profiles } = studentIds.length > 0
    ? await supabase.from("profiles").select("id, full_name, parent_email").in("id", studentIds)
        .returns<{ id: string; full_name: string | null; parent_email: string | null }[]>()
    : { data: [] };

  const nameById = new Map((profiles ?? []).map(p => [p.id, p.full_name ?? "بدون اسم"]));

  const critical = allSignals.filter(r => (r.churn_risk_score ?? 0) >= 75).length;
  const high = allSignals.filter(r => (r.churn_risk_score ?? 0) >= 60 && (r.churn_risk_score ?? 0) < 75).length;
  const lastComputed = allSignals[0]?.computed_at ?? null;
  const filtered = rows.length !== allSignals.length;

  return (
    <div dir="rtl" className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <TrendingDown size={24} className="text-gold" />
          <div>
            <h1 className="text-xl font-bold">إشارات البقاء</h1>
            <p className="text-xs text-muted">{lastComputed ? `آخر حساب ${daysAgo(lastComputed)}` : "لم يُحسب بعد"}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="rounded-full bg-red-500/10 px-3 py-1 font-bold text-red-400">{critical} حرج</span>
          <span className="rounded-full bg-orange-500/10 px-3 py-1 font-bold text-orange-400">{high} مرتفع</span>
          <RunScorerButton />
        </div>
      </div>

      <RetentionFilters />

      {rows.length === 0 ? (
        <div className="glass-card rounded-xl p-8 text-center">
          <AlertTriangle size={32} className="mx-auto mb-3 text-muted" />
          <p className="text-sm">
            {filtered
              ? "لا توجد نتائج مطابقة لهذه التصفية. جرّب تعديل المرشحات أو مسحها."
              : "لا توجد إشارات محسوبة بعد. اضغط 'تشغيل الآن' أو انتظر التشغيل التلقائي لـ n8n."}
          </p>
        </div>
      ) : (
        <div className="glass-card overflow-hidden rounded-xl">
          <table className="w-full text-sm">
            <thead className="border-b border-white/5 bg-white/[0.02] text-xs text-muted">
              <tr>
                <th className="px-4 py-3 text-right font-medium">الطالب</th>
                <th className="px-4 py-3 text-right font-medium">الخطر</th>
                <th className="px-4 py-3 text-right font-medium">التفاعل</th>
                <th className="px-4 py-3 text-right font-medium">آخر جلسة</th>
                <th className="px-4 py-3 text-right font-medium">آخر حجز</th>
                <th className="px-4 py-3 text-right font-medium">الباقة</th>
                <th className="px-4 py-3 text-right font-medium">الإجراء المقترح</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const risk = r.churn_risk_score ?? 0;
                const pkg = r.package_remaining === null ? "بدون باقة" : `${r.package_remaining} جلسة`;
                const action = recommendedAction(r);
                return (
                  <tr key={r.student_id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                    <td className="px-4 py-3">
                      <Link href={`/admin/users/${r.student_id}`} className="font-medium text-foreground hover:text-gold">
                        {nameById.get(r.student_id) ?? "—"}
                      </Link>
                    </td>
                    <td className={`px-4 py-3 font-bold ${riskTone(risk)}`}>{risk.toFixed(0)} · {riskLabel(risk)}</td>
                    <td className="px-4 py-3 text-muted">{(r.engagement_score ?? 0).toFixed(0)}</td>
                    <td className="px-4 py-3 text-muted">{daysAgo(r.last_session_at)}</td>
                    <td className="px-4 py-3 text-muted">{daysAgo(r.last_booking_at)}</td>
                    <td className="px-4 py-3 text-muted">{pkg}</td>
                    <td className="px-4 py-3">
                      {action ? (
                        <InterventionButton
                          studentId={r.student_id}
                          interventionType={action.type}
                          label={action.label}
                          lastInterventionAt={r.last_intervention_at}
                        />
                      ) : (
                        <span className="text-xs text-muted">مراقبة</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
