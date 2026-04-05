import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ClipboardCheck, Inbox } from "lucide-react";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "تقييماتي" };

const TYPE_AR: Record<string, string> = {
  weekly: "أسبوعي",
  biweekly: "نصف شهري",
  monthly: "شهري",
  quarterly: "ربع سنوي",
};

function scoreBadge(score: number | null) {
  if (score === null) return <span className="text-muted">—</span>;
  const color =
    score >= 8
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
      : score >= 5
        ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-400"
        : "border-red-500/30 bg-red-500/10 text-red-400";
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-semibold ${color}`}>
      {score}/10
    </span>
  );
}

interface EvaluationRow {
  id: string;
  student_id: string;
  evaluation_type: string;
  period_start: string;
  period_end: string;
  hifz_score: number | null;
  tajweed_score: number | null;
  akhlaq_score: number | null;
  attendance_score: number | null;
  overall_score: number | null;
  strengths: string | null;
  weaknesses: string | null;
  recommendations: string | null;
  notes: string | null;
  created_at: string;
}

export default async function TeacherEvaluationsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: evaluations } = await supabase
    .from("session_evaluations")
    .select("id, student_id, evaluation_type, period_start, period_end, hifz_score, tajweed_score, akhlaq_score, attendance_score, overall_score, strengths, weaknesses, recommendations, notes, created_at")
    .eq("teacher_id", user.id)
    .order("created_at", { ascending: false })
    .limit(200)
    .returns<EvaluationRow[]>();

  const list = evaluations ?? [];

  // Resolve student names
  let nameMap: Record<string, string> = {};
  if (list.length > 0) {
    const ids = [...new Set(list.map((e) => e.student_id))];
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", ids)
      .returns<{ id: string; full_name: string | null }[]>();
    if (profiles) {
      nameMap = Object.fromEntries(profiles.map((p) => [p.id, p.full_name ?? "طالب"]));
    }
  }

  return (
    <div dir="rtl" className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-6 flex items-center gap-2 text-2xl font-bold">
        <ClipboardCheck size={24} className="text-gold" />
        تقييماتي
      </h1>

      {list.length === 0 ? (
        <div className="rounded-2xl border border-card-border bg-card p-12 text-center">
          <Inbox size={32} className="mx-auto mb-3 text-muted" />
          <p className="text-muted">لا توجد تقييمات بعد</p>
          <p className="mt-1 text-sm text-muted">ستظهر هنا التقييمات الخاصة بطلابك</p>
        </div>
      ) : (
        <div className="space-y-4">
          {list.map((ev) => (
            <div key={ev.id} className="rounded-2xl border border-card-border bg-card p-6">
              {/* Header row */}
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{nameMap[ev.student_id] ?? "طالب"}</p>
                  <p className="mt-1 text-sm text-muted">
                    <span className="rounded-full border border-card-border bg-card px-2 py-0.5 text-xs">
                      {TYPE_AR[ev.evaluation_type] ?? ev.evaluation_type}
                    </span>
                    <span className="mr-2 text-xs">
                      {new Date(ev.period_start).toLocaleDateString("ar-SA")} — {new Date(ev.period_end).toLocaleDateString("ar-SA")}
                    </span>
                  </p>
                </div>
                <div className="text-left text-xs text-muted">
                  {new Date(ev.created_at).toLocaleDateString("ar-SA")}
                </div>
              </div>

              {/* Scores */}
              <div className="mt-4 flex flex-wrap gap-3">
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="text-muted">الحفظ:</span> {scoreBadge(ev.hifz_score)}
                </div>
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="text-muted">التجويد:</span> {scoreBadge(ev.tajweed_score)}
                </div>
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="text-muted">الأخلاق:</span> {scoreBadge(ev.akhlaq_score)}
                </div>
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="text-muted">الحضور:</span> {scoreBadge(ev.attendance_score)}
                </div>
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="font-medium">الكلية:</span> {scoreBadge(ev.overall_score)}
                </div>
              </div>

              {/* Text details */}
              {(ev.strengths || ev.weaknesses || ev.recommendations || ev.notes) && (
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {ev.strengths && (
                    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
                      <p className="mb-1 text-xs font-semibold text-emerald-400">نقاط القوة</p>
                      <p className="text-sm">{ev.strengths}</p>
                    </div>
                  )}
                  {ev.weaknesses && (
                    <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3">
                      <p className="mb-1 text-xs font-semibold text-red-400">نقاط الضعف</p>
                      <p className="text-sm">{ev.weaknesses}</p>
                    </div>
                  )}
                  {ev.recommendations && (
                    <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3">
                      <p className="mb-1 text-xs font-semibold text-blue-400">التوصيات</p>
                      <p className="text-sm">{ev.recommendations}</p>
                    </div>
                  )}
                  {ev.notes && (
                    <div className="rounded-xl border border-card-border bg-card p-3">
                      <p className="mb-1 text-xs font-semibold text-muted">ملاحظات</p>
                      <p className="text-sm">{ev.notes}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
