import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { SESSION_TYPE_AR } from "@/lib/constants";
import type { SessionType } from "@/types/database";
import { VideoRoom } from "@/app/student/sessions/[id]/video-room";
import { PostSessionForm } from "./post-session-form";
import { SessionDetailControls } from "./session-detail-controls";

export const metadata: Metadata = { title: "الجلسة" };

interface Props {
  params: Promise<{ id: string }>;
}

export default async function TeacherSessionPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

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

  if (!session) redirect("/teacher/sessions");

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

  if (!booking || booking.teacher_id !== user.id) redirect("/teacher/sessions");

  const { data: student } = await supabase
    .from("profiles").select("full_name").eq("id", booking.student_id)
    .single<{ full_name: string | null }>();

  const studentName = student?.full_name || "الطالب";
  const scheduledDate = new Date(booking.scheduled_at);
  const isCompleted = session.ended_at !== null;

  return (
    <div dir="rtl" className="mx-auto max-w-5xl px-4 py-8">
      <Link
        href="/teacher/sessions"
        className="mb-6 inline-flex items-center gap-1 text-sm text-gold transition-colors hover:text-gold-hover focus-ring"
      >
        <ArrowRight size={14} />
        العودة للجلسات
      </Link>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-card-border bg-card elevation-2 p-4">
        <div>
          <h1 className="text-lg font-bold">{studentName}</h1>
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

      {/* Session controls (timer + end/extend buttons) when active */}
      {!isCompleted && (
        <SessionDetailControls
          sessionId={session.id}
          startedAt={session.started_at}
          expiresAt={session.expires_at}
          durationMin={booking.duration_min}
          scheduledAt={booking.scheduled_at}
        />
      )}

      {isCompleted ? (
        <PostSessionForm
          sessionId={session.id}
          studentId={booking.student_id}
          studentName={studentName}
          existingNotes={session.post_session_notes}
          existingHomework={session.homework}
        />
      ) : (
        <VideoRoom
          sessionId={session.id}
          roomUrl={session.room_url}
          userName={user.user_metadata?.full_name ?? "معلم"}
          expiresAt={session.expires_at}
          durationMin={booking.duration_min}
        />
      )}
    </div>
  );
}
