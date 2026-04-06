import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { GraduationCap, Plus, Star, Inbox, FileText } from "lucide-react";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "إدارة المعلمين" };

interface TeacherRow { teacher_id: string; specialties: string[]; hourly_rate: number; rating_avg: number; total_sessions: number; is_accepting: boolean; is_archived: boolean; }

export default async function AdminTeachersPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: teachers } = await supabase.from("teacher_profiles")
    .select("teacher_id, specialties, hourly_rate, rating_avg, total_sessions, is_accepting, is_archived")
    .order("total_sessions", { ascending: false }).returns<TeacherRow[]>();
  const list = teachers ?? [];

  // Count pending CVs
  const { count: pendingCvCount } = await supabase.from("teacher_profiles")
    .select("teacher_id", { count: "exact", head: true })
    .eq("cv_status", "pending_review");

  let nameMap: Record<string, string> = {};
  if (list.length > 0) {
    const ids = list.map(t => t.teacher_id);
    const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", ids)
      .returns<{ id: string; full_name: string | null }[]>();
    if (profiles) nameMap = Object.fromEntries(profiles.map(p => [p.id, p.full_name ?? "معلم"]));
  }

  return (
    <div dir="rtl" className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-bold"><GraduationCap size={24} className="text-gold" /> إدارة المعلمين</h1>
        <div className="flex items-center gap-3">
          {(pendingCvCount ?? 0) > 0 && (
            <Link href="/admin/teachers/cv" className="flex items-center gap-2 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-400 transition-colors hover:bg-amber-500/20">
              <FileText size={16} />
              سير ذاتية معلقة
              <span className="rounded-full bg-amber-500 px-1.5 py-0.5 text-xs font-bold text-white">{pendingCvCount}</span>
            </Link>
          )}
          <Link href="/admin/teachers/new" className="flex items-center gap-2 rounded bg-gold px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gold-hover">
            <Plus size={16} /> إضافة معلم
          </Link>
        </div>
      </div>
      {list.length === 0 ? (
        <div className="rounded-xl border border-card-border bg-card p-12 text-center"><Inbox size={32} className="mx-auto mb-3 text-muted" /><p className="text-muted">لا يوجد معلمون</p></div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-card-border">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-card-border bg-card">
              <th scope="col" className="px-4 py-3 text-right font-medium text-muted">المعلم</th>
              <th scope="col" className="px-4 py-3 text-right font-medium text-muted">السعر</th>
              <th scope="col" className="px-4 py-3 text-right font-medium text-muted">التقييم</th>
              <th scope="col" className="px-4 py-3 text-right font-medium text-muted">الجلسات</th>
              <th scope="col" className="px-4 py-3 text-right font-medium text-muted">الحالة</th>
              <th scope="col" className="px-4 py-3 text-right font-medium text-muted">إجراءات</th>
            </tr></thead>
            <tbody>
              {list.map(t => (
                <tr key={t.teacher_id} className={`border-b border-card-border last:border-b-0 ${t.is_archived ? "opacity-50" : ""}`}>
                  <td className="px-4 py-3 font-medium">{nameMap[t.teacher_id] ?? "معلم"}</td>
                  <td className="px-4 py-3 text-gold">${t.hourly_rate}</td>
                  <td className="px-4 py-3"><span className="flex items-center gap-1"><Star size={12} className="fill-gold text-gold" />{Number(t.rating_avg).toFixed(1)}</span></td>
                  <td className="px-4 py-3 text-muted">{t.total_sessions}</td>
                  <td className="px-4 py-3">
                    {t.is_archived ? <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-xs text-red-400">مؤرشف</span>
                      : t.is_accepting ? <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-400">يقبل طلاب</span>
                      : <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-400">مشغول</span>}
                  </td>
                  <td className="px-4 py-3"><Link href={`/admin/teachers/${t.teacher_id}`} className="text-xs text-gold hover:text-gold-light">تفاصيل ←</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
