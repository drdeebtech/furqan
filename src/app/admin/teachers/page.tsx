import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { GraduationCap, Plus, Star, Inbox, FileText } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "إدارة المعلمين" };

interface TeacherRow { teacher_id: string; specialties: string[]; hourly_rate: number; rating_avg: number; total_sessions: number; is_accepting: boolean; is_archived: boolean; cv_status: string | null; }

export default async function AdminTeachersPage() {
  const { t, dir } = await getT();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [teachersRes, cvCountRes] = await Promise.all([
    supabase.from("teacher_profiles")
      .select("teacher_id, specialties, hourly_rate, rating_avg, total_sessions, is_accepting, is_archived, cv_status")
      .order("total_sessions", { ascending: false }).returns<TeacherRow[]>(),
    supabase.from("teacher_profiles")
      .select("teacher_id", { count: "exact", head: true })
      .eq("cv_status", "pending_review"),
  ]);
  const list = teachersRes.data ?? [];
  const pendingCvCount = cvCountRes.count;

  let nameMap: Record<string, string> = {};
  if (list.length > 0) {
    const ids = list.map(x => x.teacher_id);
    const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", ids)
      .returns<{ id: string; full_name: string | null }[]>();
    if (profiles) nameMap = Object.fromEntries(profiles.map(p => [p.id, p.full_name ?? t("معلم", "Teacher")]));
  }

  return (
    <div dir={dir} className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-bold"><GraduationCap size={24} className="text-gold" /> {t("إدارة المعلمين", "Manage Teachers")}</h1>
        <div className="flex items-center gap-3">
          {(pendingCvCount ?? 0) > 0 && (
            <Link href="/admin/teachers/cv" className="flex items-center gap-2 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-400 transition-colors hover:bg-amber-500/20">
              <FileText size={16} />
              {t("سير ذاتية معلقة", "Pending CVs")}
              <span className="rounded-md bg-amber-500/90 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">{pendingCvCount}</span>
            </Link>
          )}
          <Link href="/admin/teachers/new" className="flex items-center gap-2 glass-gold glass-pill px-4 py-2 text-sm font-medium">
            <Plus size={16} /> {t("إضافة معلم", "Add Teacher")}
          </Link>
        </div>
      </div>
      {list.length === 0 ? (
        <div className="glass-card rounded-xl p-12 text-center"><Inbox size={32} className="mx-auto mb-3 text-muted" /><p className="text-muted">{t("لا يوجد معلمون", "No teachers yet")}</p></div>
      ) : (
        <div className="overflow-hidden rounded-xl glass-card">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-white/10 bg-white/5">
              <th scope="col" className="px-4 py-3 text-start font-medium text-muted">{t("المعلم", "Teacher")}</th>
              <th scope="col" className="px-4 py-3 text-start font-medium text-muted">{t("السعر", "Rate")}</th>
              <th scope="col" className="px-4 py-3 text-start font-medium text-muted">{t("التقييم", "Rating")}</th>
              <th scope="col" className="px-4 py-3 text-start font-medium text-muted">{t("الجلسات", "Sessions")}</th>
              <th scope="col" className="px-4 py-3 text-start font-medium text-muted">{t("الحالة", "Status")}</th>
              <th scope="col" className="px-4 py-3 text-start font-medium text-muted">{t("السيرة الذاتية", "CV")}</th>
              <th scope="col" className="px-4 py-3 text-start font-medium text-muted">{t("إجراءات", "Actions")}</th>
            </tr></thead>
            <tbody>
              {list.map(x => (
                <tr key={x.teacher_id} className={`border-b border-white/10 last:border-b-0 ${x.is_archived ? "opacity-50" : ""}`}>
                  <td className="px-4 py-3 font-medium">{nameMap[x.teacher_id] ?? t("معلم", "Teacher")}</td>
                  <td className="px-4 py-3 text-gold">${x.hourly_rate}</td>
                  <td className="px-4 py-3"><span className="flex items-center gap-1"><Star size={12} className="fill-gold text-gold" />{Number(x.rating_avg).toFixed(1)}</span></td>
                  <td className="px-4 py-3 text-muted">{x.total_sessions}</td>
                  <td className="px-4 py-3">
                    {x.is_archived ? <span className="glass-badge border-red-500/30 bg-red-500/10 text-red-400">{t("مؤرشف", "Archived")}</span>
                      : x.is_accepting ? <span className="glass-badge border-emerald-500/30 bg-emerald-500/10 text-emerald-400">{t("يقبل طلاب", "Accepting")}</span>
                      : <span className="glass-badge border-amber-500/30 bg-amber-500/10 text-amber-400">{t("مشغول", "Busy")}</span>}
                  </td>
                  <td className="px-4 py-3">
                    {x.cv_status === "approved" ? (
                      <span className="glass-badge border-emerald-500/30 bg-emerald-500/10 text-emerald-400">{t("معتمد", "Approved")}</span>
                    ) : x.cv_status === "pending_review" ? (
                      <span className="glass-badge border-amber-500/30 bg-amber-500/10 text-amber-400">{t("قيد المراجعة", "Pending")}</span>
                    ) : x.cv_status === "rejected" ? (
                      <span className="glass-badge border-red-500/30 bg-red-500/10 text-red-400">{t("مرفوض", "Rejected")}</span>
                    ) : (
                      <span className="glass-badge border-white/20 bg-white/5 text-muted">{t("مسودة", "Draft")}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Link href={`/admin/teachers/${x.teacher_id}`} className="text-xs text-gold hover:text-gold-light">{t("تفاصيل", "Details")}</Link>
                      <Link href={`/admin/teachers/cv/${x.teacher_id}`} className="text-xs text-gold hover:text-gold-light">{t("السيرة", "CV")}</Link>
                    </div>
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
