import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Users, Inbox } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "المستخدمون" };

interface ProfileRow { id: string; role: string; full_name: string | null; country: string | null; is_active: boolean; created_at: string; }

export default async function ModeratorUsersPage() {
  const { t, dir, lang } = await getT();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase.from("profiles").select("id, role, full_name, country, is_active, created_at")
    .in("role", ["student", "teacher"])
    .order("created_at", { ascending: false }).returns<ProfileRow[]>();
  const users = data ?? [];
  const students = users.filter(u => u.role === "student").length;
  const teachers = users.filter(u => u.role === "teacher").length;

  return (
    <div dir={dir} className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-6 flex items-center gap-2 text-2xl font-bold"><Users size={24} className="text-gold" /> {t("المستخدمون", "Users")}</h1>
      <div className="mb-6 grid grid-cols-3 gap-3">
        {[
          { key: "all", l: t("الكل", "All"), v: users.length },
          { key: "students", l: t("طلاب", "Students"), v: students },
          { key: "teachers", l: t("معلمون", "Teachers"), v: teachers },
        ].map(s => (
          <div key={s.key} className="glass-card rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-gold">{s.v}</p><p className="text-xs text-muted">{s.l}</p>
          </div>
        ))}
      </div>
      {users.length === 0 ? (
        <div className="glass-card rounded-xl p-12 text-center"><Inbox size={32} className="mx-auto mb-3 text-muted" /><p className="text-muted">{t("لا يوجد مستخدمون", "No users yet")}</p></div>
      ) : (
        <div className="glass-card overflow-hidden rounded-xl p-0">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-white/10 bg-white/5">
              <th scope="col" className="px-4 py-3 text-right font-medium text-muted">{t("الاسم", "Name")}</th>
              <th scope="col" className="px-4 py-3 text-right font-medium text-muted">{t("الدور", "Role")}</th>
              <th scope="col" className="px-4 py-3 text-right font-medium text-muted">{t("الدولة", "Country")}</th>
              <th scope="col" className="px-4 py-3 text-right font-medium text-muted">{t("الحالة", "Status")}</th>
              <th scope="col" className="px-4 py-3 text-right font-medium text-muted">{t("التسجيل", "Joined")}</th>
            </tr></thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} className="border-b border-white/10 last:border-b-0">
                  <td className="px-4 py-3 font-medium">{u.full_name ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`glass-badge rounded-full px-2 py-0.5 text-xs ${u.role === "teacher" ? "glass glass-pill text-gold" : "text-muted"}`}>
                      {u.role === "teacher" ? t("معلم", "Teacher") : t("طالب", "Student")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted">{u.country ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`glass-badge rounded-full px-2.5 py-0.5 text-xs font-medium ${u.is_active ? "glass-success" : "glass-danger"}`}>
                      {u.is_active ? t("نشط", "Active") : t("معطل", "Disabled")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted">{new Date(u.created_at).toLocaleDateString(lang === "ar" ? "ar-SA" : "en-US")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
