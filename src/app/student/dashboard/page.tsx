import { redirect } from "next/navigation";
import Link from "next/link";
import {
  BookOpen,
  CalendarCheck,
  CheckCircle,
  Clock,
  Search,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { LogoutButton } from "@/components/shared/logout-button";
import type { BookingStatus, SessionType } from "@/types/database";

const SESSION_TYPE_AR: Record<SessionType, string> = {
  hifz: "حفظ",
  muraja: "مراجعة",
  tajweed: "تجويد",
  tilawa: "تلاوة",
  qiraat: "قراءات",
  tafsir: "تفسير",
  combined: "حفظ + مراجعة",
  other: "أخرى",
};

const STATUS_STYLE: Record<
  BookingStatus,
  { label: string; className: string }
> = {
  pending: {
    label: "بانتظار التأكيد",
    className: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
  },
  confirmed: {
    label: "مؤكد",
    className: "bg-green-500/10 text-green-400 border-green-500/30",
  },
  completed: {
    label: "مكتمل",
    className: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  },
  cancelled: {
    label: "ملغى",
    className: "bg-red-500/10 text-red-400 border-red-500/30",
  },
  no_show: {
    label: "لم يحضر",
    className: "bg-red-500/10 text-red-400 border-red-500/30",
  },
};

export default async function StudentDashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Parallel queries
  const [profileRes, upcomingRes, statsRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("full_name")
      .eq("id", user.id)
      .single<{ full_name: string | null }>(),

    supabase
      .from("bookings")
      .select("id, scheduled_at, duration_min, status, session_type, teacher_id")
      .eq("student_id", user.id)
      .in("status", ["pending", "confirmed"])
      .gte("scheduled_at", new Date().toISOString())
      .order("scheduled_at", { ascending: true })
      .limit(3)
      .returns<
        {
          id: string;
          scheduled_at: string;
          duration_min: number;
          status: BookingStatus;
          session_type: SessionType;
          teacher_id: string;
        }[]
      >(),

    supabase
      .from("bookings")
      .select("status")
      .eq("student_id", user.id)
      .returns<{ status: BookingStatus }[]>(),
  ]);

  const fullName = profileRes.data?.full_name;
  const upcoming = upcomingRes.data ?? [];
  const allBookings = statsRes.data ?? [];

  const totalBookings = allBookings.length;
  const completedSessions = allBookings.filter(
    (b) => b.status === "completed",
  ).length;

  // Fetch teacher names for upcoming bookings
  const teacherIds = [...new Set(upcoming.map((b) => b.teacher_id))];
  let teacherNames: Record<string, string> = {};

  if (teacherIds.length > 0) {
    const { data: teachers } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", teacherIds)
      .returns<{ id: string; full_name: string | null }[]>();

    if (teachers) {
      teacherNames = Object.fromEntries(
        teachers.map((t) => [t.id, t.full_name ?? "معلم"]),
      );
    }
  }

  return (
    <div dir="rtl" className="mx-auto max-w-4xl px-4 py-8">
      {/* Welcome + Logout */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            أهلاً{fullName ? ` ${fullName}` : ""}
            <span className="mr-2 text-gold">👋</span>
          </h1>
          <p className="mt-1 text-sm text-muted">
            Welcome to your dashboard
          </p>
        </div>
        <LogoutButton />
      </div>

      {/* Stats */}
      <div className="mb-8 grid grid-cols-2 gap-4">
        <div className="rounded-xl border border-card-border bg-card p-5">
          <div className="mb-2 flex items-center gap-2 text-muted">
            <BookOpen size={18} />
            <span className="text-sm">إجمالي الحجوزات</span>
          </div>
          <p className="text-3xl font-bold text-gold">{totalBookings}</p>
          <p className="mt-1 text-xs text-muted">Total bookings</p>
        </div>

        <div className="rounded-xl border border-card-border bg-card p-5">
          <div className="mb-2 flex items-center gap-2 text-muted">
            <CheckCircle size={18} />
            <span className="text-sm">جلسات مكتملة</span>
          </div>
          <p className="text-3xl font-bold text-gold">{completedSessions}</p>
          <p className="mt-1 text-xs text-muted">Completed sessions</p>
        </div>
      </div>

      {/* Quick Action */}
      <Link
        href="/student/teachers"
        className="mb-8 flex items-center justify-center gap-2 rounded-xl bg-gold px-6 py-3 font-semibold text-black transition-colors hover:bg-gold-hover"
      >
        <Search size={18} />
        تصفح المعلمين
        <span className="text-sm opacity-70">Browse Teachers</span>
      </Link>

      {/* Upcoming Bookings */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            <CalendarCheck size={20} className="ml-2 inline text-gold" />
            الحجوزات القادمة
          </h2>
          <Link
            href="/student/bookings"
            className="text-sm text-gold hover:text-gold-hover"
          >
            عرض الكل
          </Link>
        </div>

        {upcoming.length === 0 ? (
          <div className="rounded-xl border border-card-border bg-card p-8 text-center">
            <Clock size={32} className="mx-auto mb-3 text-muted" />
            <p className="text-muted">لا توجد حجوزات قادمة</p>
            <p className="mt-1 text-xs text-muted">No upcoming bookings</p>
          </div>
        ) : (
          <div className="space-y-3">
            {upcoming.map((booking) => {
              const date = new Date(booking.scheduled_at);
              const statusInfo = STATUS_STYLE[booking.status];

              return (
                <div
                  key={booking.id}
                  className="rounded-xl border border-card-border bg-card p-4"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium">
                        {teacherNames[booking.teacher_id] ?? "معلم"}
                      </p>
                      <p className="mt-1 text-sm text-gold">
                        {SESSION_TYPE_AR[booking.session_type]}
                        <span className="mr-2 text-muted">
                          · {booking.duration_min} دقيقة
                        </span>
                      </p>
                    </div>
                    <span
                      className={`rounded-full border px-2.5 py-0.5 text-xs ${statusInfo.className}`}
                    >
                      {statusInfo.label}
                    </span>
                  </div>

                  <div
                    dir="ltr"
                    className="mt-3 text-left text-sm text-muted"
                  >
                    {date.toLocaleDateString("ar-SA", {
                      weekday: "long",
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}
                    <span className="mx-2">·</span>
                    {date.toLocaleTimeString("ar-SA", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
