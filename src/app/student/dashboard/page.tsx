import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  BookOpen,
  CalendarCheck,
  CalendarPlus,
  CheckCircle,
  Clock,
  Search,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { SESSION_TYPE_AR, STATUS_STYLE } from "@/lib/constants";
import type { BookingStatus, SessionType } from "@/types/database";

export const metadata: Metadata = { title: "لوحتي" };

export default async function StudentDashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [profileRes, upcomingRes, statsRes] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", user.id)
      .single<{ full_name: string | null }>(),
    supabase.from("bookings")
      .select("id, scheduled_at, duration_min, status, session_type, teacher_id")
      .eq("student_id", user.id).in("status", ["pending", "confirmed"])
      .gte("scheduled_at", new Date().toISOString())
      .order("scheduled_at", { ascending: true }).limit(3)
      .returns<{ id: string; scheduled_at: string; duration_min: number; status: BookingStatus; session_type: SessionType; teacher_id: string }[]>(),
    supabase.from("bookings").select("status").eq("student_id", user.id)
      .returns<{ status: BookingStatus }[]>(),
  ]);

  const fullName = profileRes.data?.full_name;
  const upcoming = upcomingRes.data ?? [];
  const allBookings = statsRes.data ?? [];
  const totalBookings = allBookings.length;
  const completedSessions = allBookings.filter((b) => b.status === "completed").length;

  const teacherIds = [...new Set(upcoming.map((b) => b.teacher_id))];
  let teacherNames: Record<string, string> = {};
  if (teacherIds.length > 0) {
    const { data: teachers } = await supabase.from("profiles").select("id, full_name")
      .in("id", teacherIds).returns<{ id: string; full_name: string | null }[]>();
    if (teachers) {
      teacherNames = Object.fromEntries(teachers.map((t) => [t.id, t.full_name ?? "معلم"]));
    }
  }

  return (
    <>
      <div className="h-0.5 bg-gradient-to-l from-gold/0 via-gold/30 to-gold/0" />
      <div dir="rtl" className="mx-auto max-w-4xl px-4 py-8">

        {/* Welcome */}
        <h1 className="text-2xl font-bold">
          أهلاً{fullName ? ` ${fullName}` : ""}
        </h1>
        <p className="mt-1 text-sm text-muted">Welcome to your dashboard</p>

        {totalBookings === 0 ? (
          /* ── First-use onboarding ── */
          <div className="mt-8 rounded-xl border-r-4 border-r-gold border border-card-border bg-card p-8">
            <BookOpen size={28} className="mb-4 text-gold" />
            <h2 className="mb-2 text-xl font-bold">ابدأ رحلتك مع القرآن</h2>
            <p className="mb-6 text-sm text-muted">
              اختر معلمك، احجز جلستك الأولى، وابدأ رحلة الحفظ
            </p>
            <div className="mb-6 grid grid-cols-3 gap-4">
              {[
                { icon: Search, label: "تصفح المعلمين" },
                { icon: CalendarPlus, label: "احجز جلسة" },
                { icon: BookOpen, label: "ابدأ التعلم" },
              ].map((s) => (
                <div key={s.label} className="text-center">
                  <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full border border-card-border bg-background">
                    <s.icon size={18} className="text-gold" />
                  </div>
                  <p className="text-xs font-medium">{s.label}</p>
                </div>
              ))}
            </div>
            <Link
              href="/student/teachers"
              className="flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3 font-semibold text-white neu-btn transition-colors hover:bg-primary-hover focus-ring"
            >
              <Search size={18} />
              تصفح المعلمين الآن
            </Link>
          </div>
        ) : (
          <>
            {/* Stats — asymmetric layout, not identical cards */}
            <div className="mt-8 flex gap-4">
              <div className="flex-1 rounded-2xl border border-card-border bg-card elevation-2 p-5">
                <p className="text-sm text-muted">إجمالي الحجوزات</p>
                <p className="mt-1 text-3xl font-bold text-gold">{totalBookings}</p>
              </div>
              <div className="flex-1 rounded-2xl border border-card-border bg-card elevation-2 p-5">
                <p className="text-sm text-muted">جلسات مكتملة</p>
                <p className="mt-1 text-3xl font-bold text-gold">{completedSessions}</p>
              </div>
              <Link
                href="/student/teachers"
                className="flex items-center gap-2 rounded-xl bg-primary px-6 font-semibold text-white neu-btn transition-colors hover:bg-primary-hover focus-ring"
              >
                <Search size={18} />
                <span className="hidden sm:inline">تصفح المعلمين</span>
              </Link>
            </div>

            {/* Upcoming Bookings */}
            <div className="mt-10">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-lg font-semibold">
                  <CalendarCheck size={20} className="text-gold" />
                  الحجوزات القادمة
                </h2>
                <Link href="/student/bookings" className="text-sm text-gold transition-colors hover:text-gold-hover focus-ring">
                  عرض الكل
                </Link>
              </div>

              {upcoming.length === 0 ? (
                <div className="rounded-2xl border border-card-border bg-card elevation-2 p-8 text-center">
                  <Clock size={28} className="mx-auto mb-3 text-muted" />
                  <p className="text-muted">لا توجد حجوزات قادمة</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {upcoming.map((booking) => {
                    const date = new Date(booking.scheduled_at);
                    const statusInfo = STATUS_STYLE[booking.status];
                    return (
                      <div key={booking.id} className="rounded-2xl border border-card-border bg-card elevation-2 p-4">
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="font-medium">{teacherNames[booking.teacher_id] ?? "معلم"}</p>
                            <p className="mt-1 text-sm text-gold">
                              {SESSION_TYPE_AR[booking.session_type]}
                              <span className="mr-2 text-muted">· {booking.duration_min} دقيقة</span>
                            </p>
                          </div>
                          <span className={`rounded-full border px-2.5 py-0.5 text-xs ${statusInfo.className}`}>
                            {statusInfo.label}
                          </span>
                        </div>
                        <p dir="ltr" className="mt-3 text-left text-sm text-muted">
                          {date.toLocaleDateString("ar-SA", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
                          <span className="mx-2">·</span>
                          {date.toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
