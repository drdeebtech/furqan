import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ClipboardCheck, Inbox, AlertCircle, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "تقييماتي" };

const TYPE_AR: Record<string, string> = {
  weekly: "أسبوعي",
  biweekly: "نصف شهري",
  monthly: "شهري",
  quarterly: "ربع سنوي",
};

const TYPE_EN: Record<string, string> = {
  weekly: "Weekly",
  biweekly: "Bi-weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
};

function scoreBadge(score: number | null) {
  if (score === null) return <span className="text-muted">—</span>;
  const color =
    score >= 8
      ? "border-success/30 bg-success/10 text-success"
      : score >= 5
        ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-400"
        : "border-error/30 bg-error/10 text-red-400";
  return (
    <span className={`glass-badge inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${color}`}>
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
  const { t, dir, lang } = await getT();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Past evaluations + this teacher's full student roster (so we can
  // compute who is due/never-evaluated). Both queries run in parallel.
  const [evalsRes, rosterRes] = await Promise.all([
    supabase
      .from("session_evaluations")
      .select("id, student_id, evaluation_type, period_start, period_end, hifz_score, tajweed_score, akhlaq_score, attendance_score, overall_score, strengths, weaknesses, recommendations, notes, created_at")
      .eq("teacher_id", user.id)
      .order("created_at", { ascending: false })
      .limit(200)
      .returns<EvaluationRow[]>(),
    supabase
      .from("bookings")
      .select("student_id")
      .eq("teacher_id", user.id)
      .in("status", ["confirmed", "completed"])
      .returns<{ student_id: string }[]>(),
  ]);

  const list = evalsRes.data ?? [];
  const rosterStudentIds = [...new Set((rosterRes.data ?? []).map(r => r.student_id))];

  // Latest-evaluation-per-student lookup, keyed by student_id. Lets us
  // compute days-since-last-eval for each student in the roster.
  const latestEvalAt: Record<string, string> = {};
  for (const e of list) {
    if (!latestEvalAt[e.student_id]) latestEvalAt[e.student_id] = e.created_at;
  }

  // Compute the "due for evaluation" queue: students in this teacher's
  // roster who either (a) have never been evaluated, or (b) were last
  // evaluated 30+ days ago. Order: never-evaluated first, then oldest.
  const nowMs = Date.now();
  const dueQueue = rosterStudentIds
    .map(id => {
      const lastIso = latestEvalAt[id];
      const days = lastIso
        ? Math.floor((nowMs - new Date(lastIso).getTime()) / 86400_000)
        : null;
      return { studentId: id, daysSince: days };
    })
    .filter(s => s.daysSince === null || s.daysSince > 30)
    .sort((a, b) => {
      if (a.daysSince === null && b.daysSince !== null) return -1;
      if (b.daysSince === null && a.daysSince !== null) return 1;
      return (b.daysSince ?? 0) - (a.daysSince ?? 0);
    });

  // Resolve student names — needs both eval-list students AND the
  // due-queue students (which may not yet have any evaluation).
  let nameMap: Record<string, string> = {};
  const allIds = [...new Set([
    ...list.map((e) => e.student_id),
    ...dueQueue.map(d => d.studentId),
  ])];
  if (allIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", allIds)
      .returns<{ id: string; full_name: string | null }[]>();
    if (profiles) {
      nameMap = Object.fromEntries(profiles.map((p) => [p.id, p.full_name || t("طالب", "Student")]));
    }
  }

  return (
    <div dir={dir} className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-6 flex items-center gap-2 text-2xl font-bold">
        <ClipboardCheck size={24} className="text-gold" />
        {t("تقييماتي", "My Evaluations")}
      </h1>

      {/* Due for evaluation queue — students in this teacher's roster
          who have never been evaluated or whose last evaluation was 30+
          days ago. Surfaces the work the teacher should be doing instead
          of just showing what they've already done. */}
      {dueQueue.length > 0 && (
        <div className="mb-6 rounded-2xl border border-warning/30 bg-warning/5 p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-warning">
            <AlertCircle size={14} aria-hidden="true" />
            {t(`بحاجة تقييم (${dueQueue.length})`, `Due for evaluation (${dueQueue.length})`)}
          </h2>
          <ul className="space-y-1.5">
            {dueQueue.slice(0, 6).map(d => {
              const name = nameMap[d.studentId] ?? t("طالب", "Student");
              return (
                <li key={d.studentId}>
                  <Link
                    href={`/teacher/students/${d.studentId}`}
                    className="flex items-center justify-between gap-2 rounded-lg border border-card-border bg-card/40 px-3 py-2 text-sm transition-colors hover:border-warning/30 focus-ring"
                  >
                    <span className="font-medium">{name}</span>
                    <span className="flex items-center gap-2 text-xs text-muted">
                      {d.daysSince === null
                        ? t("لم يُقيَّم بعد", "Never evaluated")
                        : t(`آخر تقييم قبل ${d.daysSince} يوم`, `Last evaluated ${d.daysSince}d ago`)}
                      <ChevronRight size={12} aria-hidden="true" />
                    </span>
                  </Link>
                </li>
              );
            })}
            {dueQueue.length > 6 && (
              <li>
                <Link
                  href="/teacher/students"
                  className="block rounded-lg border border-dashed border-card-border bg-transparent px-3 py-2 text-center text-xs text-muted hover:text-foreground/80 focus-ring"
                >
                  {t(`و ${dueQueue.length - 6} طلاب آخرين ←`, `and ${dueQueue.length - 6} more students →`)}
                </Link>
              </li>
            )}
          </ul>
        </div>
      )}

      {list.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Inbox size={32} className="mx-auto mb-3 text-muted" />
          <p className="text-muted">{t("لا توجد تقييمات بعد", "No evaluations yet")}</p>
          <p className="mt-1 text-sm text-muted">{t("ستظهر هنا التقييمات الخاصة بطلابك", "Evaluations for your students will appear here")}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {list.map((ev) => {
            const locale = lang === "ar" ? "ar" : "en-US";
            return (
            <div key={ev.id} className="glass-card p-6">
              {/* Header row */}
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{nameMap[ev.student_id] ?? t("طالب", "Student")}</p>
                  <p className="mt-1 text-sm text-muted">
                    <span className="glass-badge rounded-full px-2 py-0.5 text-xs">
                      {(lang === "ar" ? TYPE_AR : TYPE_EN)[ev.evaluation_type] ?? ev.evaluation_type}
                    </span>
                    <span className="me-2 text-xs">
                      {new Date(ev.period_start).toLocaleDateString(locale)} — {new Date(ev.period_end).toLocaleDateString(locale)}
                    </span>
                  </p>
                </div>
                <div className="text-left text-xs text-muted">
                  {new Date(ev.created_at).toLocaleDateString(locale)}
                </div>
              </div>

              {/* Scores */}
              <div className="mt-4 flex flex-wrap gap-3">
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="text-muted">{t("الحفظ", "Hifz")}:</span> {scoreBadge(ev.hifz_score)}
                </div>
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="text-muted">{t("التجويد", "Tajweed")}:</span> {scoreBadge(ev.tajweed_score)}
                </div>
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="text-muted">{t("الأخلاق", "Akhlaq")}:</span> {scoreBadge(ev.akhlaq_score)}
                </div>
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="text-muted">{t("الحضور", "Attendance")}:</span> {scoreBadge(ev.attendance_score)}
                </div>
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="font-medium">{t("الكلية", "Overall")}:</span> {scoreBadge(ev.overall_score)}
                </div>
              </div>

              {/* Text details */}
              {(ev.strengths || ev.weaknesses || ev.recommendations || ev.notes) && (
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {ev.strengths && (
                    <div className="glass-success glass rounded-xl p-3">
                      <p className="mb-1 text-xs font-semibold text-success">{t("نقاط القوة", "Strengths")}</p>
                      <p className="break-words whitespace-pre-wrap text-sm">{ev.strengths}</p>
                    </div>
                  )}
                  {ev.weaknesses && (
                    <div className="glass-danger glass rounded-xl p-3">
                      <p className="mb-1 text-xs font-semibold text-red-400">{t("نقاط الضعف", "Weaknesses")}</p>
                      <p className="break-words whitespace-pre-wrap text-sm">{ev.weaknesses}</p>
                    </div>
                  )}
                  {ev.recommendations && (
                    <div className="glass rounded-xl border-blue-500/20 p-3">
                      <p className="mb-1 text-xs font-semibold text-blue-400">{t("التوصيات", "Recommendations")}</p>
                      <p className="break-words whitespace-pre-wrap text-sm">{ev.recommendations}</p>
                    </div>
                  )}
                  {ev.notes && (
                    <div className="glass rounded-xl p-3">
                      <p className="mb-1 text-xs font-semibold text-muted">{t("ملاحظات", "Notes")}</p>
                      <p className="break-words whitespace-pre-wrap text-sm">{ev.notes}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
