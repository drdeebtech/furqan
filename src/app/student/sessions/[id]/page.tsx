import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { SESSION_TYPE_AR } from "@/lib/constants";
import type { SessionType } from "@/types/database";
import { VideoRoom } from "./video-room";

export const metadata: Metadata = { title: "الجلسة" };

interface Props {
  params: Promise<{ id: string }>;
}

export default async function SessionPage({ params }: Props) {
  const { id } = await params;
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

  const teacherName = teacher?.full_name ?? "المعلم";
  const scheduledDate = new Date(booking.scheduled_at);
  const isCompleted = session.ended_at !== null;

  return (
    <div dir="rtl" className="mx-auto max-w-5xl px-4 py-8">
      <Link
        href="/student/sessions"
        className="mb-6 inline-flex items-center gap-1 text-sm text-gold transition-colors hover:text-gold-hover focus-ring"
      >
        <ArrowRight size={14} />
        العودة للجلسات
      </Link>

      {/* Session info bar */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-card-border bg-card elevation-2 p-4">
        <div>
          <h1 className="text-lg font-bold">{teacherName}</h1>
          <p className="mt-1 text-sm text-gold">
            {SESSION_TYPE_AR[booking.session_type]}
            <span className="mr-2 text-muted">· {booking.duration_min} دقيقة</span>
          </p>
          <p dir="ltr" className="mt-1 text-left text-sm text-muted">
            {scheduledDate.toLocaleDateString("ar-SA", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
            <span className="mx-2">·</span>
            {scheduledDate.toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>
        {isCompleted && session.actual_duration && (
          <div className="rounded-full border border-card-border px-3 py-1 text-sm text-muted">
            مدة الجلسة: {session.actual_duration} دقيقة
          </div>
        )}
      </div>

      {/* Video room or completed state */}
      {isCompleted ? (
        <div className="space-y-4">
          <div className="rounded-2xl border border-card-border bg-card elevation-2 p-8 text-center">
            <p className="text-lg font-semibold text-gold">تمت الجلسة بنجاح</p>
            <p className="mt-1 text-sm text-muted">Session completed</p>
          </div>

          {session.post_session_notes && (
            <div className="rounded-2xl border border-card-border bg-card elevation-2 p-5">
              <h2 className="mb-2 text-sm font-semibold text-gold">ملاحظات المعلم</h2>
              <p className="text-sm leading-relaxed text-muted">{session.post_session_notes}</p>
            </div>
          )}

          {session.homework && (
            <div className="rounded-xl border border-gold/20 bg-gold/5 p-5">
              <h2 className="mb-2 text-sm font-semibold text-gold">الواجب</h2>
              <p className="text-sm leading-relaxed text-muted">{session.homework}</p>
            </div>
          )}
        </div>
      ) : (
        <VideoRoom
          sessionId={session.id}
          roomUrl={session.room_url}
          userName={user.user_metadata?.full_name ?? "طالب"}
          expiresAt={session.expires_at}
          scheduledAt={booking.scheduled_at}
          durationMin={booking.duration_min}
        />
      )}
    </div>
  );
}
