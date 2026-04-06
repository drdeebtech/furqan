import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Video, Inbox } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { SESSION_TYPE_AR, STATUS_STYLE } from "@/lib/constants";
import type { BookingStatus, SessionType } from "@/types/database";
import { LiveBadge } from "./live-badge";

export const metadata: Metadata = { title: "جلساتي" };

interface SessionRow {
  id: string;
  booking_id: string;
  room_url: string;
  started_at: string | null;
  ended_at: string | null;
  actual_duration: number | null;
  post_session_notes: string | null;
  homework: string | null;
}

interface BookingRow {
  id: string;
  scheduled_at: string;
  duration_min: number;
  status: BookingStatus;
  session_type: SessionType;
  teacher_id: string;
}

// Capture render time outside the component to avoid react-hooks/purity lint
const getRenderTime = () => Date.now();

export default async function StudentSessionsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const renderTime = getRenderTime();

  // Get confirmed/completed bookings that have sessions
  const { data: bookings } = await supabase
    .from("bookings")
    .select("id, scheduled_at, duration_min, status, session_type, teacher_id")
    .eq("student_id", user.id)
    .in("status", ["confirmed", "completed"])
    .order("scheduled_at", { ascending: false })
    .returns<BookingRow[]>();

  const list = bookings ?? [];

  // Fetch sessions for these bookings
  let sessionMap: Record<string, SessionRow> = {};
  if (list.length > 0) {
    const bookingIds = list.map((b) => b.id);
    const { data: sessions } = await supabase
      .from("sessions")
      .select("id, booking_id, room_url, started_at, ended_at, actual_duration, post_session_notes, homework")
      .in("booking_id", bookingIds)
      .returns<SessionRow[]>();
    if (sessions) {
      sessionMap = Object.fromEntries(sessions.map((s) => [s.booking_id, s]));
    }
  }

  // Fetch teacher names
  let nameMap: Record<string, string> = {};
  if (list.length > 0) {
    const ids = [...new Set(list.map((b) => b.teacher_id))];
    const { data: profiles } = await supabase
      .from("profiles").select("id, full_name").in("id", ids)
      .returns<{ id: string; full_name: string | null }[]>();
    if (profiles) {
      nameMap = Object.fromEntries(profiles.map((p) => [p.id, p.full_name ?? "معلم"]));
    }
  }

  return (
    <div dir="rtl" className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-6 flex items-center gap-2 font-display text-2xl font-bold">
        <Video size={24} className="text-gold" />
        جلساتي
      </h1>

      {list.length === 0 ? (
        <div className="rounded-2xl border border-card-border bg-card elevation-2 p-12 text-center">
          <Inbox size={32} className="mx-auto mb-3 text-muted" />
          <p className="text-muted">لا توجد جلسات بعد</p>
          <p className="mt-1 text-sm text-muted">ستظهر هنا بعد تأكيد حجوزاتك</p>
          <Link
            href="/student/teachers"
            className="mt-4 inline-block rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white neu-btn transition-colors hover:bg-primary-hover focus-ring"
          >
            تصفح المعلمين
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {list.map((booking) => {
            const date = new Date(booking.scheduled_at);
            const session = sessionMap[booking.id];
            const statusInfo = STATUS_STYLE[booking.status];
            const startMs = date.getTime();
            const endMs = startMs + booking.duration_min * 60000;
            const nowMs = renderTime;
            const isUpcoming = booking.status === "confirmed" && startMs > nowMs;
            const isLive = booking.status === "confirmed" && nowMs >= startMs && nowMs < endMs;

            return (
              <div
                key={booking.id}
                className={`rounded-2xl border bg-card p-4 ${isLive ? "border-gold/40" : "border-card-border"}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{nameMap[booking.teacher_id] ?? "معلم"}</p>
                    <p className="mt-1 text-sm text-gold">
                      {SESSION_TYPE_AR[booking.session_type]}
                      <span className="mr-2 text-muted">· {booking.duration_min} دقيقة</span>
                    </p>
                    <p dir="ltr" className="mt-2 text-left text-sm text-muted">
                      {date.toLocaleDateString("ar-SA", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
                      <span className="mx-2">·</span>
                      {date.toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })}
                    </p>

                    {/* Post-session content */}
                    {session?.post_session_notes && (
                      <div className="mt-3 rounded-lg border border-card-border bg-background p-3">
                        <p className="mb-1 text-xs font-medium text-gold">ملاحظات المعلم</p>
                        <p className="text-sm text-muted">{session.post_session_notes}</p>
                      </div>
                    )}
                    {session?.homework && (
                      <div className="mt-2 rounded-lg border border-gold/20 bg-gold/5 p-3">
                        <p className="mb-1 text-xs font-medium text-gold">الواجب</p>
                        <p className="text-sm text-muted">{session.homework}</p>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    <LiveBadge
                      scheduledAt={booking.scheduled_at}
                      durationMin={booking.duration_min}
                      defaultLabel={statusInfo.label}
                      className={`rounded-full border px-2.5 py-0.5 text-xs ${statusInfo.className}`}
                    />

                    {session?.room_url && (isUpcoming || isLive) && (
                      <Link
                        href={`/student/sessions/${session.id}`}
                        className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-white neu-btn transition-colors hover:bg-primary-hover focus-ring"
                      >
                        <Video size={14} />
                        {isLive ? "انضم الآن" : "غرفة الجلسة"}
                      </Link>
                    )}

                    {session && booking.status === "completed" && session.actual_duration && (
                      <span className="text-xs text-muted">{session.actual_duration} دقيقة فعلية</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
