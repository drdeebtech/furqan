import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ClipboardCheck, Inbox, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "التقييمات" };

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
  teacher_id: string;
  evaluation_type: string;
  period_start: string;
  period_end: string;
  overall_score: number | null;
  created_at: string;
}

export default async function AdminEvaluationsPage() {
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

  // Resolve names
  let nameMap: Record<string, string> = {};
  if (list.length > 0) {
    const ids = [...new Set([...list.map((e) => e.student_id), ...list.map((e) => e.teacher_id)])];
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", ids)
      .returns<{ id: string; full_name: string | null }[]>();
    if (profiles) {
      nameMap = Object.fromEntries(profiles.map((p) => [p.id, p.full_name ?? "—"]));
    }
  }

  return (
    <div dir="rtl" className="mx-auto max-w-5xl px-4 py-8">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <ClipboardCheck size={24} className="text-gold" /> التقييمات
        </h1>
        <Link
          href="/admin/evaluations/new"
          className="mr-auto inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
        >
          <Plus size={16} />
          إنشاء تقييم
        </Link>
      </div>

      {/* Table */}
      {list.length === 0 ? (
        <div className="rounded-2xl border border-card-border bg-card p-12 text-center">
          <Inbox size={32} className="mx-auto mb-3 text-muted" />
          <p className="text-muted">لا توجد تقييمات بعد</p>
          <p className="mt-1 text-sm text-muted">ابدأ بإنشاء تقييم جديد للطلاب</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-card-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-card-border bg-card">
                <th scope="col" className="px-3 py-3 text-right font-medium text-muted">الطالب</th>
                <th scope="col" className="px-3 py-3 text-right font-medium text-muted">المعلم</th>
                <th scope="col" className="px-3 py-3 text-right font-medium text-muted">النوع</th>
                <th scope="col" className="px-3 py-3 text-right font-medium text-muted">الفترة</th>
                <th scope="col" className="px-3 py-3 text-right font-medium text-muted">الدرجة الكلية</th>
                <th scope="col" className="px-3 py-3 text-right font-medium text-muted">التاريخ</th>
              </tr>
            </thead>
            <tbody>
              {list.map((ev) => (
                <tr key={ev.id} className="border-b border-card-border last:border-b-0 hover:bg-surface-alt/50">
                  <td className="px-3 py-3 font-medium">{nameMap[ev.student_id] ?? "—"}</td>
                  <td className="px-3 py-3">{nameMap[ev.teacher_id] ?? "—"}</td>
                  <td className="px-3 py-3">
                    <span className="rounded-full border border-card-border bg-card px-2 py-0.5 text-xs">
                      {TYPE_AR[ev.evaluation_type] ?? ev.evaluation_type}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-xs text-muted">
                    {new Date(ev.period_start).toLocaleDateString("ar-SA")} — {new Date(ev.period_end).toLocaleDateString("ar-SA")}
                  </td>
                  <td className="px-3 py-3">{scoreBadge(ev.overall_score)}</td>
                  <td className="px-3 py-3 text-xs text-muted">
                    {new Date(ev.created_at).toLocaleDateString("ar-SA")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
