import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Users, GraduationCap, BookOpen, DollarSign } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { ArchiveToggle } from "./archive-toggle";

export const metadata: Metadata = { title: "لوحة الإدارة" };

interface TeacherRow {
  teacher_id: string;
  hourly_rate: number;
  rating_avg: number;
  total_sessions: number;
  is_accepting: boolean;
  is_archived: boolean;
}

export default async function AdminDashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [studentsRes, teachersRes, bookingsRes, revenueRes] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "student"),
    supabase.from("teacher_profiles")
      .select("teacher_id, hourly_rate, rating_avg, total_sessions, is_accepting, is_archived")
      .order("is_archived", { ascending: true })
      .order("total_sessions", { ascending: false }).returns<TeacherRow[]>(),
    supabase.from("bookings").select("id", { count: "exact", head: true }),
    supabase.from("bookings").select("amount_usd").eq("status", "completed")
      .returns<{ amount_usd: number }[]>(),
  ]);

  const studentCount = studentsRes.count ?? 0;
  const teacherList = teachersRes.data ?? [];
  const bookingCount = bookingsRes.count ?? 0;
  const totalRevenue = (revenueRes.data ?? []).reduce((sum, b) => sum + Number(b.amount_usd), 0);

  let nameMap: Record<string, string> = {};
  if (teacherList.length > 0) {
    const ids = teacherList.map((t) => t.teacher_id);
    const { data: profiles } = await supabase.from("profiles").select("id, full_name")
      .in("id", ids).returns<{ id: string; full_name: string | null }[]>();
    if (profiles) {
      nameMap = Object.fromEntries(profiles.map((p) => [p.id, p.full_name ?? "معلم"]));
    }
  }

  return (
    <>
      <div className="h-0.5 bg-gradient-to-l from-gold/0 via-gold/30 to-gold/0" />
      <div dir="rtl" className="mx-auto max-w-5xl px-4 py-8">

        <h1 className="text-2xl font-bold">لوحة الإدارة</h1>
        <p className="mt-1 text-sm text-muted">Admin dashboard</p>

        {/* Stats — responsive grid */}
        <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
          {[
            { icon: Users, label: "الطلاب", value: studentCount, en: "Students" },
            { icon: GraduationCap, label: "المعلمون", value: teacherList.length, en: "Teachers" },
            { icon: BookOpen, label: "الحجوزات", value: bookingCount, en: "Bookings" },
            { icon: DollarSign, label: "الإيرادات", value: `$${totalRevenue.toFixed(2)}`, en: "Revenue" },
          ].map((s) => (
            <div key={s.en} className="rounded-2xl border border-card-border bg-card elevation-2 p-5">
              <div className="flex items-center gap-2 text-sm text-muted">
                <s.icon size={16} />
                {s.label}
              </div>
              <p className="mt-1 text-2xl font-bold text-gold">{s.value}</p>
              <p className="mt-1 text-xs text-muted">{s.en}</p>
            </div>
          ))}
        </div>

        {/* Teachers list */}
        <div className="mt-10">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
            <GraduationCap size={20} className="text-gold" />
            إدارة المعلمين
          </h2>

          {teacherList.length === 0 ? (
            <div className="rounded-2xl border border-card-border bg-card elevation-2 p-8 text-center">
              <GraduationCap size={28} className="mx-auto mb-3 text-muted" />
              <p className="text-muted">لا يوجد معلمون بعد</p>
            </div>
          ) : (
            <div className="space-y-3">
              {teacherList.map((teacher) => (
                <div
                  key={teacher.teacher_id}
                  className={`rounded-xl border bg-card p-4 ${
                    teacher.is_archived ? "border-error/20 opacity-60" : "border-card-border"
                  }`}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{nameMap[teacher.teacher_id] ?? "معلم"}</p>
                        {teacher.is_archived && (
                          <span className="rounded-full border border-error/30 bg-error/10 px-2 py-0.5 text-xs text-error">مؤرشف</span>
                        )}
                        {!teacher.is_archived && teacher.is_accepting && (
                          <span className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-xs text-success">يقبل طلاب</span>
                        )}
                        {!teacher.is_archived && !teacher.is_accepting && (
                          <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs text-foreground">مشغول</span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-muted">
                        ${teacher.hourly_rate}/ساعة
                        <span className="mx-2">·</span>
                        {teacher.total_sessions} جلسة
                        <span className="mx-2">·</span>
                        تقييم {Number(teacher.rating_avg) > 0 ? Number(teacher.rating_avg).toFixed(1) : "—"}
                      </p>
                    </div>
                    <ArchiveToggle teacherId={teacher.teacher_id} isArchived={teacher.is_archived} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
