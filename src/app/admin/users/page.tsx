import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Users, Inbox, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { UserRow } from "./user-row";

export const metadata: Metadata = { title: "المستخدمون" };

interface ProfileRow { id: string; role: string; full_name: string | null; country: string | null; is_active: boolean; created_at: string; }

export default async function AdminUsersPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase.from("profiles").select("id, role, full_name, country, is_active, created_at")
    .order("created_at", { ascending: false }).returns<ProfileRow[]>();
  const users = data ?? [];
  const students = users.filter(u => u.role === "student").length;
  const teachers = users.filter(u => u.role === "teacher").length;
  const admins = users.filter(u => u.role === "admin").length;

  return (
    <div dir="rtl" className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-bold"><Users size={24} className="text-gold" /> المستخدمون</h1>
        <Link href="/admin/users/new" className="flex items-center gap-2 rounded bg-gold px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gold-hover">
          <Plus size={16} /> إنشاء مستخدم
        </Link>
      </div>
      <div className="mb-6 grid grid-cols-4 gap-3">
        {[{ l: "الكل", v: users.length }, { l: "طلاب", v: students }, { l: "معلمون", v: teachers }, { l: "مدراء", v: admins }].map(s => (
          <div key={s.l} className="rounded-xl border border-card-border bg-card p-4 text-center">
            <p className="text-2xl font-bold text-gold">{s.v}</p><p className="text-xs text-muted">{s.l}</p>
          </div>
        ))}
      </div>
      {users.length === 0 ? (
        <div className="rounded-xl border border-card-border bg-card p-12 text-center"><Inbox size={32} className="mx-auto mb-3 text-muted" /><p className="text-muted">لا يوجد مستخدمون</p></div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-card-border">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-card-border bg-card">
              <th scope="col" className="px-4 py-3 text-right font-medium text-muted">الاسم</th>
              <th scope="col" className="px-4 py-3 text-right font-medium text-muted">الدور</th>
              <th scope="col" className="px-4 py-3 text-right font-medium text-muted">الدولة</th>
              <th scope="col" className="px-4 py-3 text-right font-medium text-muted">الحالة</th>
              <th scope="col" className="px-4 py-3 text-right font-medium text-muted">التسجيل</th>
            </tr></thead>
            <tbody>{users.map(u => <UserRow key={u.id} user={u} />)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
