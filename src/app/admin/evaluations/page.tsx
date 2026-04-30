import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ClipboardCheck, Inbox, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { buildNameMap } from "@/lib/admin/name-map";
import { getT } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "التقييمات" };

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
    <span className={`inline-block glass-badge font-semibold ${color}`}>
      {score}/10
    </span>
  );
}

interface EvaluationRow {
  id: string;
  student_id: string;
  teacher_id: string;
  evaluation_type: string;
  period_start: string;
  period_end: string;
  overall_score: number | null;
  created_at: string;
}

export default async function AdminEvaluationsPage() {
  const { t, dir, lang } = await getT();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: evaluations } = await supabase
    .from("session_evaluations")
    .select("id, student_id, teacher_id, evaluation_type, period_start, period_end, overall_score, created_at")
    .order("created_at", { ascending: false })
    .limit(200)
    .returns<EvaluationRow[]>();

  const list = evaluations ?? [];

  const nameMap = await buildNameMap(
    supabase,
    [...new Set([...list.map((e) => e.student_id), ...list.map((e) => e.teacher_id)])],
  );

  return (
    <div dir={dir} className="mx-auto max-w-5xl px-4 py-8">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <ClipboardCheck size={24} className="text-gold" /> {t("التقييمات", "Evaluations")}
        </h1>
        <Link
          href="/admin/evaluations/new"
          className="me-auto inline-flex items-center gap-2 glass-gold glass-pill px-4 py-2 text-sm font-semibold transition-colors"
        >
          <Plus size={16} />
          {t("إنشاء تقييم", "New Evaluation")}
        </Link>
      </div>

      {/* Table */}
      {list.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Inbox size={32} className="mx-auto mb-3 text-muted" />
          <p className="text-muted">{t("لا توجد تقييمات بعد", "No evaluations yet")}</p>
          <p className="mt-1 text-sm text-muted">{t("ابدأ بإنشاء تقييم جديد للطلاب", "Create an evaluation for your students")}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl glass-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                <th scope="col" className="px-3 py-3 text-start font-medium text-muted">{t("الطالب", "Student")}</th>
                <th scope="col" className="px-3 py-3 text-start font-medium text-muted">{t("المعلم", "Teacher")}</th>
                <th scope="col" className="px-3 py-3 text-start font-medium text-muted">{t("النوع", "Type")}</th>
                <th scope="col" className="px-3 py-3 text-start font-medium text-muted">{t("الفترة", "Period")}</th>
                <th scope="col" className="px-3 py-3 text-start font-medium text-muted">{t("الدرجة الكلية", "Overall Score")}</th>
                <th scope="col" className="px-3 py-3 text-start font-medium text-muted">{t("التاريخ", "Date")}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((ev) => {
                const locale = lang === "ar" ? "ar" : "en-US";
                return (
                <tr key={ev.id} className="border-b border-white/10 last:border-b-0 hover:bg-surface-alt/50">
                  <td className="px-3 py-3 font-medium">{nameMap[ev.student_id] ?? "—"}</td>
                  <td className="px-3 py-3">{nameMap[ev.teacher_id] ?? "—"}</td>
                  <td className="px-3 py-3">
                    <span className="glass-badge">
                      {(lang === "ar" ? TYPE_AR : TYPE_EN)[ev.evaluation_type] ?? ev.evaluation_type}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-xs text-muted">
                    {new Date(ev.period_start).toLocaleDateString(locale)} — {new Date(ev.period_end).toLocaleDateString(locale)}
                  </td>
                  <td className="px-3 py-3">{scoreBadge(ev.overall_score)}</td>
                  <td className="px-3 py-3 text-xs text-muted">
                    {new Date(ev.created_at).toLocaleDateString(locale)}
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
