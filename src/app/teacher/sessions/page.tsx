import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Video, Inbox, AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { SESSION_TYPE_AR, STATUS_STYLE } from "@/lib/constants";
import { getT } from "@/lib/i18n/server";
import type { BookingStatus, SessionType, SessionMode } from "@/types/database";
import { SessionModeBadge } from "@/components/sessions/SessionModeBadge";
import { EmptyState } from "@/components/shared/empty-state";

export const metadata: Metadata = { title: "جلساتي" };

const SESSION_TYPE_EN: Record<SessionType, string> = {
  hifz: "Hifz", muraja: "Review", tajweed: "Tajweed", tilawa: "Tilawa",
  qiraat: "Qiraat", tafsir: "Tafsir", combined: "Hifz + Review", other: "Other",
};

interface SessionBooking {
  id: string;
  scheduled_at: string;
  duration_min: number;
  status: BookingStatus;
  session_type: SessionType;
  amount_usd: number;
  student_id: string;
}

export default async function TeacherSessionsPage() {
  const { t, dir, lang } = await getT();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: bookings } = await supabase
    .from("bookings")
    .select("id, scheduled_at, duration_min, status, session_type, amount_usd, student_id")
    .eq("teacher_id", user.id)
    .in("status", ["confirmed", "completed"])
    .order("scheduled_at", { ascending: false })
    .returns<SessionBooking[]>();

  const list = bookings ?? [];

  // Fetch sessions for join links + session_mode for the mode badge.
  let sessionIdMap: Record<string, string> = {};
  let sessionModeMap: Record<string, SessionMode> = {};
  if (list.length > 0) {
    const bookingIds = list.map((b) => b.id);
    const { data: sessions } = await supabase
      .from("sessions").select("id, booking_id, session_mode").in("booking_id", bookingIds)
      .returns<{ id: string; booking_id: string; session_mode: SessionMode }[]>();
    if (sessions) {
      sessionIdMap = Object.fromEntries(sessions.map((s) => [s.booking_id, s.id]));
      sessionModeMap = Object.fromEntries(sessions.map((s) => [s.booking_id, s.session_mode]));
    }
  }

  let nameMap: Record<string, string> = {};
  if (list.length > 0) {
    const ids = [...new Set(list.map((b) => b.student_id))];
    const { data: profiles } = await supabase
      .from("profiles").select("id, full_name").in("id", ids)
      .returns<{ id: string; full_name: string | null }[]>();
    if (profiles) {
      nameMap = Object.fromEntries(profiles.map((p) => [p.id, p.full_name || t("طالب", "Student")]));
    }
  }

  return (
    <div dir={dir} className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-6 flex items-center gap-2 text-2xl font-bold">
        <Video size={24} className="text-gold" />
        {t("جلساتي", "My Sessions")}
      </h1>

      {list.length === 0 ? (
        <EmptyState
          variant="glass-card"
          icon={<Inbox size={32} className="text-muted" />}
          message={t("لا توجد جلسات مؤكدة", "No confirmed sessions yet")}
          hint={t("ستظهر هنا بعد تأكيد الحجوزات", "They'll appear here once bookings are confirmed")}
        />
      ) : (
        <div className="space-y-3">
          {list.map((booking) => {
            const date = new Date(booking.scheduled_at);
            const statusInfo = STATUS_STYLE[booking.status as "confirmed" | "completed"];
            const sessionId = sessionIdMap[booking.id];
            const isConfirmed = booking.status === "confirmed";
            // F9 (resolved 2026-05-05): symmetric framing with /student/sessions.
            // A confirmed booking whose scheduled_at + duration + 30min grace
            // has passed without a status flip is in lifecycle limbo. The
            // teacher sees the same "Awaiting confirmation" framing the
            // student sees so both views agree on reality.
            const endTimePlusGrace = new Date(date.getTime() + (booking.duration_min + 30) * 60_000);
            const isPastUnresolved = isConfirmed && endTimePlusGrace < new Date();

            return (
              <div key={booking.id} className="glass-card p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{nameMap[booking.student_id] ?? t("طالب", "Student")}</p>
                      <SessionModeBadge mode={sessionModeMap[booking.id]} size="sm" />
                    </div>
                    <p className="mt-1 text-sm text-gold">
                      {lang === "ar" ? SESSION_TYPE_AR[booking.session_type] : SESSION_TYPE_EN[booking.session_type]}
                      <span className="me-2 text-muted">· {booking.duration_min} {t("دقيقة", "min")}</span>
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    {isPastUnresolved ? (
                      <span className="glass-badge rounded-full border border-warning/30 bg-warning/10 px-2.5 py-0.5 text-xs text-warning">
                        {t("بانتظار التأكيد", "Awaiting confirmation")}
                      </span>
                    ) : (
                      statusInfo && (
                        <span className={`glass-badge rounded-full px-2.5 py-0.5 text-xs ${statusInfo.className}`}>
                          {t(statusInfo.label.ar, statusInfo.label.en)}
                        </span>
                      )
                    )}
                    {sessionId && (
                      <Link
                        href={`/teacher/sessions/${sessionId}`}
                        className="glass-gold glass-pill flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-primary-hover focus-ring"
                      >
                        <Video size={14} />
                        {isPastUnresolved ? t("إنهاء الجلسة", "End session") : isConfirmed ? t("انضم للجلسة", "Join Session") : t("تفاصيل", "Details")}
                      </Link>
                    )}
                  </div>
                </div>
                <p dir="ltr" className="mt-3 text-left text-sm text-muted">
                  {date.toLocaleDateString(lang === "ar" ? "ar-EG" : "en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
                  <span className="mx-2">·</span>
                  {date.toLocaleTimeString(lang === "ar" ? "ar-EG" : "en-US", { hour: "2-digit", minute: "2-digit" })}
                </p>
                {isPastUnresolved && (
                  <div className="mt-3 rounded-lg border border-warning/30 bg-warning/10 p-3">
                    <p className="flex items-center gap-1.5 text-sm font-medium text-warning">
                      <AlertTriangle size={14} aria-hidden="true" />
                      {t("بانتظار التأكيد", "Awaiting confirmation")}
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      {t(
                        "هذا الموعد قد مرّ ولم يُحدَّث بعد. إن كانت الجلسة قد تمّت، أنهِها من صفحة الجلسة. وإن لم تتم، حدّث الحالة إلى \"لم تتم\".",
                        "This time has passed without an update. If the session happened, end it from the session page. If it didn't, mark it as missed.",
                      )}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
