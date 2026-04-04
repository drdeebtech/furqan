import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  BookOpen,
  CalendarCheck,
  Clock,
  ExternalLink,
  Hourglass,
  Star,
  Video,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { BookingActions } from "./booking-actions";
import { SESSION_TYPE_AR } from "@/lib/constants";
import type { BookingStatus, SessionType } from "@/types/database";

export const metadata: Metadata = { title: "لوحة المعلم" };

interface PendingBooking {
  id: string;
  scheduled_at: string;
  duration_min: number;
  session_type: SessionType;
  amount_usd: number;
  student_id: string;
}

export default async function TeacherDashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  const [profileRes, tpRes, pendingRes, allRes, todayRes] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", user.id)
      .single<{ full_name: string | null }>(),
    supabase.from("teacher_profiles").select("total_sessions, rating_avg").eq("teacher_id", user.id)
      .single<{ total_sessions: number; rating_avg: number }>(),
    supabase.from("bookings")
      .select("id, scheduled_at, duration_min, session_type, amount_usd, student_id")
      .eq("teacher_id", user.id).eq("status", "pending")
      .order("scheduled_at", { ascending: true }).returns<PendingBooking[]>(),
    supabase.from("bookings").select("status").eq("teacher_id", user.id)
      .returns<{ status: BookingStatus }[]>(),
    supabase.from("bookings")
      .select("id, scheduled_at, duration_min, session_type, student_id")
      .eq("teacher_id", user.id).eq("status", "confirmed")
      .gte("scheduled_at", todayStart.toISOString())
      .lte("scheduled_at", todayEnd.toISOString())
      .order("scheduled_at", { ascending: true }).returns<PendingBooking[]>(),
  ]);

  const fullName = profileRes.data?.full_name;
  const totalSessions = tpRes.data?.total_sessions ?? 0;
  const ratingAvg = Number(tpRes.data?.rating_avg ?? 0);
  const pending = pendingRes.data ?? [];
  const allBookings = allRes.data ?? [];
  const pendingCount = allBookings.filter((b) => b.status === "pending").length;
  const todaySessions = todayRes.data ?? [];

  let roomUrlMap: Record<string, string | null> = {};
  if (todaySessions.length > 0) {
    const bookingIds = todaySessions.map((b) => b.id);
    const { data: sessions } = await supabase.from("sessions")
      .select("booking_id, room_url").in("booking_id", bookingIds)
      .returns<{ booking_id: string; room_url: string }[]>();
    if (sessions) {
      roomUrlMap = Object.fromEntries(sessions.map((s) => [s.booking_id, s.room_url]));
    }
  }

  const allStudentIds = [...pending.map((b) => b.student_id), ...todaySessions.map((b) => b.student_id)];
  let studentNames: Record<string, string> = {};
  if (allStudentIds.length > 0) {
    const ids = [...new Set(allStudentIds)];
    const { data: profiles } = await supabase.from("profiles").select("id, full_name")
      .in("id", ids).returns<{ id: string; full_name: string | null }[]>();
    if (profiles) {
      studentNames = Object.fromEntries(profiles.map((p) => [p.id, p.full_name ?? "طالب"]));
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
        <p className="mt-1 text-sm text-muted">Teacher dashboard</p>

        {/* Stats row — varied layout */}
        <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
          <div className="rounded-xl border border-card-border bg-card p-5">
            <div className="flex items-center gap-2 text-sm text-muted">
              <BookOpen size={16} />
              جلسات مكتملة
            </div>
            <p className="mt-1 text-3xl font-bold text-gold">{totalSessions}</p>
          </div>
          <div className="rounded-xl border border-card-border bg-card p-5">
            <div className="flex items-center gap-2 text-sm text-muted">
              <Hourglass size={16} />
              بانتظار التأكيد
            </div>
            <p className="mt-1 text-3xl font-bold text-gold">{pendingCount}</p>
          </div>
          <div className="rounded-xl border border-card-border bg-card p-5">
            <div className="flex items-center gap-2 text-sm text-muted">
              <Star size={16} />
              التقييم
            </div>
            <p className="mt-1 text-3xl font-bold text-gold">
              {ratingAvg > 0 ? ratingAvg.toFixed(1) : "—"}
            </p>
          </div>
        </div>

        {/* Today's Sessions */}
        {todaySessions.length > 0 && (
          <div className="mt-10">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
              <CalendarCheck size={20} className="text-gold" />
              جلسات اليوم
            </h2>
            <div className="space-y-3">
              {todaySessions.map((booking) => {
                const date = new Date(booking.scheduled_at);
                const url = roomUrlMap[booking.id];
                return (
                  <div key={booking.id} className="rounded-xl border border-gold/20 bg-card p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="font-medium">{studentNames[booking.student_id] ?? "طالب"}</p>
                        <p className="mt-1 text-sm text-gold">
                          {SESSION_TYPE_AR[booking.session_type]}
                          <span className="mr-2 text-muted">· {booking.duration_min} دقيقة</span>
                        </p>
                        <p dir="ltr" className="mt-1 text-left text-sm text-muted">
                          {date.toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                      {url ? (
                        <a href={url} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-1.5 rounded-lg bg-gold px-3 py-1.5 text-xs font-semibold text-black transition-colors hover:bg-gold-hover focus-ring">
                          <Video size={14} />
                          انضم للجلسة
                        </a>
                      ) : (
                        <span className="text-xs text-muted">لم يُنشأ رابط بعد</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Pending Bookings */}
        <div className="mt-10">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
            <Clock size={20} className="text-gold" />
            حجوزات بانتظار التأكيد
          </h2>
          {pending.length === 0 ? (
            <div className="rounded-xl border border-card-border bg-card p-8 text-center">
              <Clock size={28} className="mx-auto mb-3 text-muted" />
              <p className="text-muted">لا توجد حجوزات معلقة</p>
            </div>
          ) : (
            <div className="space-y-3">
              {pending.map((booking) => {
                const date = new Date(booking.scheduled_at);
                return (
                  <div key={booking.id} className="rounded-xl border border-card-border bg-card p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{studentNames[booking.student_id] ?? "طالب"}</p>
                        <p className="mt-1 text-sm text-gold">
                          {SESSION_TYPE_AR[booking.session_type]}
                          <span className="mr-2 text-muted">· {booking.duration_min} دقيقة · ${booking.amount_usd}</span>
                        </p>
                        <p dir="ltr" className="mt-2 text-left text-sm text-muted">
                          {date.toLocaleDateString("ar-SA", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
                          <span className="mx-2">·</span>
                          {date.toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                      <BookingActions bookingId={booking.id} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
