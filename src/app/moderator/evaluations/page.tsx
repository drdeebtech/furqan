import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ClipboardCheck, Plus, Inbox } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";

export const metadata: Metadata = { title: "التقييمات" };

interface EvalRow {
  id: string; student_id: string; teacher_id: string; evaluation_type: string;
  evaluation_date: string; overall_score: number | null; created_at: string;
}

const TYPE_AR: Record<string, string> = { weekly: "أسبوعي", biweekly: "نصف شهري", monthly: "شهري", quarterly: "ربع سنوي" };
const TYPE_EN: Record<string, string> = { weekly: "Weekly", biweekly: "Bi-weekly", monthly: "Monthly", quarterly: "Quarterly" };

export default async function ModeratorEvaluationsPage() {
  const { t, dir, lang } = await getT();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: evals } = await supabase.from("session_evaluations")
    .select("id, student_id, teacher_id, evaluation_type, evaluation_date, overall_score, created_at")
    .order("created_at", { ascending: false }).limit(50).returns<EvalRow[]>();
  const list = evals ?? [];

  // Resolve names
  let nameMap: Record<string, string> = {};
  if (list.length > 0) {
    const ids = [...new Set([...list.map(e => e.student_id), ...list.map(e => e.teacher_id)])];
    const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", ids)
      .returns<{ id: string; full_name: string | null }[]>();
    if (profiles) nameMap = Object.fromEntries(profiles.map(p => [p.id, p.full_name ?? "—"]));
  }

  return (
    <div dir={dir} className="mx-auto max-w-5xl px-4 py-8">
      <PageHeader
        icon={<ClipboardCheck size={24} className="text-gold" />}
        title={t("التقييمات", "Evaluations")}
        actions={
          <Link href="/moderator/evaluations/new" className="glass-gold glass-pill flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors">
            <Plus size={16} /> {t("تقييم جديد", "New Evaluation")}
          </Link>
        }
      />

      {list.length === 0 ? (
        <EmptyState
          variant="glass-card"
          icon={<Inbox size={32} className="text-muted" />}
          message={t("لا توجد تقييمات", "No evaluations yet")}
        />
      ) : (
        <div className="glass-card overflow-hidden rounded-xl p-0">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-white/10 bg-white/5">
              <th scope="col" className="px-4 py-3 text-start font-medium text-muted">{t("الطالب", "Student")}</th>
              <th scope="col" className="px-4 py-3 text-start font-medium text-muted">{t("المعلم", "Teacher")}</th>
              <th scope="col" className="px-4 py-3 text-start font-medium text-muted">{t("النوع", "Type")}</th>
              <th scope="col" className="px-4 py-3 text-start font-medium text-muted">{t("تاريخ التقييم", "Eval Date")}</th>
              <th scope="col" className="px-4 py-3 text-start font-medium text-muted">{t("الدرجة", "Score")}</th>
              <th scope="col" className="px-4 py-3 text-start font-medium text-muted">{t("تاريخ الإنشاء", "Created")}</th>
            </tr></thead>
            <tbody>
              {list.map(e => (
                <tr key={e.id} className="border-b border-white/10 last:border-b-0">
                  <td className="px-4 py-3 font-medium">{nameMap[e.student_id] ?? "—"}</td>
                  <td className="px-4 py-3">{nameMap[e.teacher_id] ?? "—"}</td>
                  <td className="px-4 py-3"><span className="glass-badge rounded-full px-2 py-0.5 text-xs">{(lang === "ar" ? TYPE_AR : TYPE_EN)[e.evaluation_type] ?? e.evaluation_type}</span></td>
                  <td className="px-4 py-3 text-xs text-muted">{e.evaluation_date}</td>
                  <td className="px-4 py-3">
                    {e.overall_score ? (
                      <span className={`glass-badge rounded-full px-2 py-0.5 text-xs font-medium ${e.overall_score >= 7 ? "glass-success" : e.overall_score >= 4 ? "text-warning" : "glass-danger"}`}>
                        {e.overall_score}/10
                      </span>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted">{new Date(e.created_at).toLocaleDateString(lang === "ar" ? "ar" : "en-US")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
