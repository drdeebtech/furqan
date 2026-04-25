import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { SESSION_TYPE_AR } from "@/lib/constants";
import { getT } from "@/lib/i18n/server";
import type { SessionType } from "@/types/database";

const SESSION_TYPE_EN: Record<SessionType, string> = {
  hifz: "Hifz", muraja: "Review", tajweed: "Tajweed", tilawa: "Tilawa",
  qiraat: "Qiraat", tafsir: "Tafsir", combined: "Hifz + Review", other: "Other",
};
import { SessionTimer } from "@/components/shared/session-timer";
import { VideoRoom } from "./video-room";
import { RateTeacherForm } from "./rate-teacher-form";

export const metadata: Metadata = { title: "الجلسة" };

interface Props {
  params: Promise<{ id: string }>;
}

export default async function SessionPage({ params }: Props) {
  const { id } = await params;
  const { t, dir, lang } = await getT();
  const locale = lang === "ar" ? "ar" : "en-US";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Fetch session with booking details
  const { data: session } = await supabase
    .from("sessions")
    .select("id, booking_id, room_url, room_name, expires_at, started_at, ended_at, actual_duration, post_session_notes, homework")
    .eq("id", id)
    .single<{
      id: string;
      booking_id: string;
      room_url: string;
      room_name: string;
      expires_at: string | null;
      started_at: string | null;
      ended_at: string | null;
      actual_duration: number | null;
      post_session_notes: string | null;
      homework: string | null;
    }>();

  if (!session) redirect("/student/sessions");

  // Fetch booking to verify student owns it
  const { data: booking } = await supabase
    .from("bookings")
    .select("student_id, teacher_id, scheduled_at, duration_min, session_type")
    .eq("id", session.booking_id)
    .single<{
      student_id: string;
      teacher_id: string;
      scheduled_at: string;
      duration_min: number;
      session_type: SessionType;
    }>();

  if (!booking || booking.student_id !== user.id) redirect("/student/sessions");

  // Fetch teacher name
  const { data: teacher } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", booking.teacher_id)
    .single<{ full_name: string | null }>();

  const teacherName = teacher?.full_name ?? t("المعلم", "Teacher");
  const scheduledDate = new Date(booking.scheduled_at);
  const isCompleted = session.ended_at !== null;

  // Fetch existing review if session is completed
  let existingReview: { rating: number; comment: string | null } | null = null;
  if (isCompleted) {
    const { data: review } = await supabase
      .from("reviews")
      .select("rating, comment")
      .eq("booking_id", session.booking_id)
      .eq("student_id", user.id)
      .single<{ rating: number; comment: string | null }>();
    existingReview = review;
  }

  return (
    <div dir={dir} className="mx-auto max-w-5xl px-4 py-8">
      <Link
        href="/student/sessions"
        className="mb-6 inline-flex items-center gap-1 text-sm text-gold transition-colors hover:text-gold-hover focus-ring"
      >
        <ArrowRight size={14} />
        {t("العودة للجلسات", "Back to Sessions")}
      </Link>

      {/* Session info bar */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 glass-card p-4">
        <div>
          <h1 className="font-display text-xl font-bold">{teacherName}</h1>
          <p className="mt-1 text-sm text-gold">
            {lang === "ar" ? SESSION_TYPE_AR[booking.session_type] : SESSION_TYPE_EN[booking.session_type]}
            <span className="me-2 text-muted">· {booking.duration_min} {t("دقيقة", "min")}</span>
          </p>
          <p dir="ltr" className="mt-1 text-left text-sm text-muted">
            {scheduledDate.toLocaleDateString(locale, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
            <span className="mx-2">·</span>
            {scheduledDate.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>
        {session.started_at && !session.ended_at && (
          <SessionTimer startedAt={session.started_at} durationMin={booking.duration_min} />
        )}
        {isCompleted && session.actual_duration && (
          <div className="glass-badge px-3 py-1 text-sm text-muted">
            {t("مدة الجلسة", "Session duration")}: {session.actual_duration} {t("دقيقة", "min")}
          </div>
        )}
      </div>

      {/* Video room or completed state */}
      {isCompleted ? (
        <div className="space-y-4">
          <div className="glass-card p-8 text-center">
            <p className="text-lg font-semibold text-gold">{t("تمت الجلسة بنجاح", "Session completed successfully")}</p>
            {lang === "ar" && <p className="mt-1 text-sm text-muted">Session completed</p>}
          </div>

          {session.post_session_notes && (
            <div className="glass-card p-5">
              <h2 className="mb-2 font-display text-sm font-semibold text-gold">{t("ملاحظات المعلم", "Teacher Notes")}</h2>
              <p className="text-sm leading-relaxed text-muted">{session.post_session_notes}</p>
            </div>
          )}

          {session.homework && (
            <div className="glass-card p-5">
              <h2 className="mb-2 font-display text-sm font-semibold text-gold">{t("الواجب", "Homework")}</h2>
              <p className="text-sm leading-relaxed text-muted">{session.homework}</p>
            </div>
          )}

          {/* Review section */}
          {existingReview ? (
            <div className="glass-card p-5">
              <h2 className="mb-2 font-display text-sm font-semibold text-gold">{t("تقييمك", "Your Rating")}</h2>
              <div className="mb-2 flex gap-1">
                {Array.from({ length: 5 }, (_, i) => (
                  <span key={i} className={i < existingReview.rating ? "text-gold" : "text-muted/40"}>
                    {i < existingReview.rating ? (
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                    )}
                  </span>
                ))}
              </div>
              {existingReview.comment && (
                <p className="text-sm leading-relaxed text-muted">{existingReview.comment}</p>
              )}
            </div>
          ) : (
            <RateTeacherForm sessionId={session.id} teacherName={teacherName} />
          )}
        </div>
      ) : (
        <VideoRoom
          sessionId={session.id}
          roomUrl={session.room_url}
          userName={user.user_metadata?.full_name ?? t("طالب", "Student")}
          expiresAt={session.expires_at}
          durationMin={booking.duration_min}
          startedAt={session.started_at}
        />
      )}
    </div>
  );
}
