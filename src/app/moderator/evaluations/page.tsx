import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ClipboardCheck, Plus, Inbox } from "lucide-react";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "التقييمات" };

interface EvalRow {
  id: string; student_id: string; teacher_id: string; evaluation_type: string;
  period_start: string; period_end: string; overall_score: number | null; created_at: string;
}

const TYPE_AR: Record<string, string> = { weekly: "أسبوعي", biweekly: "نصف شهري", monthly: "شهري", quarterly: "ربع سنوي" };

export default async function ModeratorEvaluationsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: evals } = await supabase.from("session_evaluations")
    .select("id, student_id, teacher_id, evaluation_type, period_start, period_end, overall_score, created_at")
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
    <div dir="rtl" className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-bold"><ClipboardCheck size={24} className="text-gold" /> التقييمات</h1>
        <Link href="/moderator/evaluations/new" className="flex items-center gap-2 rounded bg-gold px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gold-hover">
          <Plus size={16} /> تقييم جديد
        </Link>
      </div>

      {list.length === 0 ? (
        <div className="rounded-xl border border-card-border bg-card p-12 text-center">
          <Inbox size={32} className="mx-auto mb-3 text-muted" /><p className="text-muted">لا توجد تقييمات</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-card-border">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-card-border bg-card">
              <th className="px-4 py-3 text-right font-medium text-muted">الطالب</th>
              <th className="px-4 py-3 text-right font-medium text-muted">المعلم</th>
              <th className="px-4 py-3 text-right font-medium text-muted">النوع</th>
              <th className="px-4 py-3 text-right font-medium text-muted">الفترة</th>
              <th className="px-4 py-3 text-right font-medium text-muted">الدرجة</th>
              <th className="px-4 py-3 text-right font-medium text-muted">التاريخ</th>
            </tr></thead>
            <tbody>
              {list.map(e => (
                <tr key={e.id} className="border-b border-card-border last:border-b-0">
                  <td className="px-4 py-3 font-medium">{nameMap[e.student_id] ?? "—"}</td>
                  <td className="px-4 py-3">{nameMap[e.teacher_id] ?? "—"}</td>
                  <td className="px-4 py-3"><span className="rounded-full border border-card-border bg-surface px-2 py-0.5 text-xs">{TYPE_AR[e.evaluation_type] ?? e.evaluation_type}</span></td>
                  <td className="px-4 py-3 text-xs text-muted">{e.period_start} — {e.period_end}</td>
                  <td className="px-4 py-3">
                    {e.overall_score ? (
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${e.overall_score >= 7 ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30" : e.overall_score >= 4 ? "bg-amber-500/10 text-amber-400 border border-amber-500/30" : "bg-red-500/10 text-red-400 border border-red-500/30"}`}>
                        {e.overall_score}/10
                      </span>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted">{new Date(e.created_at).toLocaleDateString("ar-SA")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
