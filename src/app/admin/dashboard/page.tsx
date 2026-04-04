import { redirect } from "next/navigation";
import {
  Users,
  GraduationCap,
  BookOpen,
  DollarSign,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { ArchiveToggle } from "./archive-toggle";

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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const [studentsRes, teachersRes, bookingsRes, revenueRes] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "student"),

      supabase
        .from("teacher_profiles")
        .select(
          "teacher_id, hourly_rate, rating_avg, total_sessions, is_accepting, is_archived",
        )
        .order("is_archived", { ascending: true })
        .order("total_sessions", { ascending: false })
        .returns<TeacherRow[]>(),

      supabase
        .from("bookings")
        .select("id", { count: "exact", head: true }),

      supabase
        .from("bookings")
        .select("amount_usd")
        .eq("status", "completed")
        .returns<{ amount_usd: number }[]>(),
    ]);

  const studentCount = studentsRes.count ?? 0;
  const teacherList = teachersRes.data ?? [];
  const bookingCount = bookingsRes.count ?? 0;
  const totalRevenue = (revenueRes.data ?? []).reduce(
    (sum, b) => sum + Number(b.amount_usd),
    0,
  );

  // Fetch teacher names
  let nameMap: Record<string, string> = {};
  if (teacherList.length > 0) {
    const ids = teacherList.map((t) => t.teacher_id);
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", ids)
      .returns<{ id: string; full_name: string | null }[]>();

    if (profiles) {
      nameMap = Object.fromEntries(
        profiles.map((p) => [p.id, p.full_name ?? "معلم"]),
      );
    }
  }

  const stats = [
    {
      icon: Users,
      label: "الطلاب",
      en: "Students",
      value: studentCount,
    },
    {
      icon: GraduationCap,
      label: "المعلمون",
      en: "Teachers",
      value: teacherList.length,
    },
    {
      icon: BookOpen,
      label: "الحجوزات",
      en: "Bookings",
      value: bookingCount,
    },
    {
      icon: DollarSign,
      label: "الإيرادات",
      en: "Revenue",
      value: `$${totalRevenue.toFixed(2)}`,
    },
  ];

  return (
    <div dir="rtl" className="mx-auto max-w-5xl px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold">
          لوحة الإدارة
          <span className="mr-2 text-gold">⚙</span>
        </h1>
        <p className="mt-1 text-sm text-muted">Admin dashboard</p>
      </div>

      {/* Stats grid */}
      <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        {stats.map((s) => (
          <div
            key={s.en}
            className="rounded-xl border border-card-border bg-card p-5"
          >
            <div className="mb-2 flex items-center gap-2 text-muted">
              <s.icon size={18} />
              <span className="text-sm">{s.label}</span>
            </div>
            <p className="text-2xl font-bold text-gold">{s.value}</p>
            <p className="mt-1 text-xs text-muted">{s.en}</p>
          </div>
        ))}
      </div>

      {/* Teachers list */}
      <div>
        <h2 className="mb-4 text-lg font-semibold">
          <GraduationCap size={20} className="ml-2 inline text-gold" />
          إدارة المعلمين
        </h2>

        {teacherList.length === 0 ? (
          <div className="rounded-xl border border-card-border bg-card p-8 text-center">
            <GraduationCap size={32} className="mx-auto mb-3 text-muted" />
            <p className="text-muted">لا يوجد معلمون بعد</p>
          </div>
        ) : (
          <div className="space-y-3">
            {teacherList.map((teacher) => (
              <div
                key={teacher.teacher_id}
                className={`rounded-xl border bg-card p-4 ${
                  teacher.is_archived
                    ? "border-red-500/20 opacity-60"
                    : "border-card-border"
                }`}
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium">
                        {nameMap[teacher.teacher_id] ?? "معلم"}
                      </p>
                      {teacher.is_archived && (
                        <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-xs text-red-400">
                          مؤرشف
                        </span>
                      )}
                      {!teacher.is_archived && teacher.is_accepting && (
                        <span className="rounded-full border border-green-500/30 bg-green-500/10 px-2 py-0.5 text-xs text-green-400">
                          يقبل طلاب
                        </span>
                      )}
                      {!teacher.is_archived && !teacher.is_accepting && (
                        <span className="rounded-full border border-yellow-500/30 bg-yellow-500/10 px-2 py-0.5 text-xs text-yellow-400">
                          مشغول
                        </span>
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

                  <ArchiveToggle
                    teacherId={teacher.teacher_id}
                    isArchived={teacher.is_archived}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
