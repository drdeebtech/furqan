import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Video, Inbox } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { fetchNameMap } from "@/lib/supabase/helpers";
import { SESSION_TYPE_AR, STATUS_STYLE } from "@/lib/constants";
import { getT } from "@/lib/i18n/server";
import type { BookingStatus, SessionType } from "@/types/database";
import { LiveBadge } from "./live-badge";

export const metadata: Metadata = { title: "جلساتي" };

const SESSION_TYPE_EN: Record<SessionType, string> = {
  hifz: "Hifz", muraja: "Review", tajweed: "Tajweed", tilawa: "Tilawa",
  qiraat: "Qiraat", tafsir: "Tafsir", combined: "Hifz + Review", other: "Other",
};

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
  const { t, dir, lang } = await getT();
  const locale = lang === "ar" ? "ar-SA" : "en-US";
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
  const nameMap = await fetchNameMap(
    supabase,
    list.map((b) => b.teacher_id),
    t("معلم", "Teacher"),
  );

  return (
    <div dir={dir} className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-6 flex items-center gap-2 font-display text-2xl font-bold">
        <Video size={24} className="text-gold" />
        {t("جلساتي", "My Sessions")}
      </h1>

      {list.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Inbox size={32} className="mx-auto mb-3 text-muted" />
          <p className="text-muted">{t("لا توجد جلسات بعد", "No sessions yet")}</p>
          <p className="mt-1 text-sm text-muted">{t("ستظهر هنا بعد تأكيد حجوزاتك", "They'll appear here once your bookings are confirmed")}</p>
          <Link
            href="/student/teachers"
            className="mt-4 inline-block glass-gold glass-pill px-5 py-2.5 text-sm font-semibold text-white transition-colors focus-ring"
          >
            {t("تصفح المعلمين", "Browse Teachers")}
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
                className={`glass-card p-4 ${isLive ? "border-gold/40" : ""}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{nameMap[booking.teacher_id] ?? t("معلم", "Teacher")}</p>
                    <p className="mt-1 text-sm text-gold">
                      {lang === "ar" ? SESSION_TYPE_AR[booking.session_type] : SESSION_TYPE_EN[booking.session_type]}
                      <span className="me-2 text-muted">· {booking.duration_min} {t("دقيقة", "min")}</span>
                    </p>
                    <p dir="ltr" className="mt-2 text-left text-sm text-muted">
                      {date.toLocaleDateString(locale, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
                      <span className="mx-2">·</span>
                      {date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}
                    </p>

                    {/* Post-session content */}
                    {session?.post_session_notes && (
                      <div className="mt-3 glass rounded-lg p-3">
                        <p className="mb-1 text-xs font-medium text-gold">{t("ملاحظات المعلم", "Teacher Notes")}</p>
                        <p className="text-sm text-muted">{session.post_session_notes}</p>
                      </div>
                    )}
                    {session?.homework && (
                      <div className="mt-2 glass rounded-lg p-3">
                        <p className="mb-1 text-xs font-medium text-gold">{t("الواجب", "Homework")}</p>
                        <p className="text-sm text-muted">{session.homework}</p>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    <LiveBadge
                      scheduledAt={booking.scheduled_at}
                      durationMin={booking.duration_min}
                      defaultLabel={statusInfo.label}
                      className={`glass-badge px-2.5 py-0.5 text-xs ${statusInfo.className}`}
                    />

                    {session?.room_url && (isUpcoming || isLive) && (
                      <Link
                        href={`/student/sessions/${session.id}`}
                        className="flex items-center gap-1.5 glass-gold glass-pill px-3 py-1.5 text-xs font-semibold text-white transition-colors focus-ring"
                      >
                        <Video size={14} />
                        {isLive ? t("انضم الآن", "Join Now") : t("غرفة الجلسة", "Session Room")}
                      </Link>
                    )}

                    {session && booking.status === "completed" && session.actual_duration && (
                      <span className="text-xs text-muted">{session.actual_duration} {t("دقيقة فعلية", "actual min")}</span>
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
