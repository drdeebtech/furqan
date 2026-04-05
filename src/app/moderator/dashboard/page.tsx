import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LayoutDashboard, Users, FileText, Video, ClipboardCheck } from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "لوحة المشرف" };

export default async function ModeratorDashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [
    { count: studentCount },
    { count: teacherCount },
    { count: pendingCvCount },
    { count: activeSessionCount },
    { count: evalCount },
  ] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "student"),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "teacher"),
    supabase.from("teacher_profiles").select("id", { count: "exact", head: true }).eq("cv_status", "pending_review"),
    supabase.from("sessions").select("id", { count: "exact", head: true }).not("started_at", "is", null).is("ended_at", null),
    supabase.from("session_evaluations").select("id", { count: "exact", head: true }),
  ]);

  const stats = [
    { label: "طلاب", value: studentCount ?? 0, icon: Users, href: "/moderator/users" },
    { label: "معلمون", value: teacherCount ?? 0, icon: Users, href: "/moderator/users" },
    { label: "سير ذاتية معلقة", value: pendingCvCount ?? 0, icon: FileText, href: "/moderator/cv-review" },
    { label: "جلسات نشطة", value: activeSessionCount ?? 0, icon: Video, href: "/moderator/sessions" },
    { label: "تقييمات", value: evalCount ?? 0, icon: ClipboardCheck, href: "/moderator/evaluations" },
  ];

  return (
    <div dir="rtl" className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-6 flex items-center gap-2 text-2xl font-bold">
        <LayoutDashboard size={24} className="text-gold" /> لوحة المشرف
      </h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className="rounded-2xl border border-card-border bg-card p-6 transition-colors hover:border-gold/30">
            <div className="flex items-center gap-3">
              <s.icon size={20} className="text-gold" />
              <div>
                <p className="text-2xl font-bold text-gold">{s.value}</p>
                <p className="text-sm text-muted">{s.label}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
