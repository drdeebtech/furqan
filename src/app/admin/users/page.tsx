import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Users, Inbox, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { UserRow } from "./user-row";

export const metadata: Metadata = { title: "المستخدمون" };

interface ProfileRow { id: string; role: string; full_name: string | null; country: string | null; is_active: boolean; created_at: string; }

export default async function AdminUsersPage() {
  const { t, dir } = await getT();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase.from("profiles").select("id, role, full_name, country, is_active, created_at")
    .order("created_at", { ascending: false }).returns<ProfileRow[]>();
  const users = data ?? [];

  const studentIds = users.filter(u => u.role === "student").map(u => u.id);
  const { data: signals } = studentIds.length > 0
    ? await supabase.from("retention_signals")
        .select("student_id, churn_risk_score")
        .in("student_id", studentIds)
        .returns<{ student_id: string; churn_risk_score: number | null }[]>()
    : { data: [] };
  const riskByStudent = new Map((signals ?? []).map(s => [s.student_id, s.churn_risk_score]));

  const students = users.filter(u => u.role === "student").length;
  const teachers = users.filter(u => u.role === "teacher").length;
  const admins = users.filter(u => u.role === "admin").length;

  return (
    <div dir={dir} className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-bold"><Users size={24} className="text-gold" /> {t("المستخدمون", "Users")}</h1>
        <Link href="/admin/users/new" className="flex items-center gap-2 glass-gold glass-pill px-4 py-2 text-sm font-medium">
          <Plus size={16} /> {t("إنشاء مستخدم", "New User")}
        </Link>
      </div>
      <div className="mb-6 grid grid-cols-4 gap-3">
        {[
          { key: "all", l: t("الكل", "All"), v: users.length },
          { key: "students", l: t("طلاب", "Students"), v: students },
          { key: "teachers", l: t("معلمون", "Teachers"), v: teachers },
          { key: "admins", l: t("مدراء", "Admins"), v: admins },
        ].map(s => (
          <div key={s.key} className="glass-card rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-gold">{s.v}</p><p className="text-xs text-muted">{s.l}</p>
          </div>
        ))}
      </div>
      {users.length === 0 ? (
        <div className="glass-card rounded-xl p-12 text-center"><Inbox size={32} className="mx-auto mb-3 text-muted" /><p className="text-muted">{t("لا يوجد مستخدمون", "No users yet")}</p></div>
      ) : (
        <div className="overflow-hidden rounded-xl glass-card">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-white/10 bg-white/5">
              <th scope="col" className="px-4 py-3 text-right font-medium text-muted">{t("الاسم", "Name")}</th>
              <th scope="col" className="px-4 py-3 text-right font-medium text-muted">{t("الدور", "Role")}</th>
              <th scope="col" className="px-4 py-3 text-right font-medium text-muted">{t("الدولة", "Country")}</th>
              <th scope="col" className="px-4 py-3 text-right font-medium text-muted">{t("الحالة", "Status")}</th>
              <th scope="col" className="px-4 py-3 text-right font-medium text-muted">{t("خطر التسرب", "Churn Risk")}</th>
              <th scope="col" className="px-4 py-3 text-right font-medium text-muted">{t("التسجيل", "Joined")}</th>
            </tr></thead>
            <tbody>{users.map(u => <UserRow key={u.id} user={u} churnRisk={u.role === "student" ? riskByStudent.get(u.id) ?? null : undefined} />)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
