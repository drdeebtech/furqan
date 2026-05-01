import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { SESSION_TYPE_AR } from "@/lib/constants";
import { getT } from "@/lib/i18n/server";
import { riskBadgeClass, riskLabel } from "@/lib/retention/ui";
import type { SessionType, HomeworkAssignment } from "@/types/database";

const SESSION_TYPE_EN: Record<SessionType, string> = {
  hifz: "Hifz", muraja: "Review", tajweed: "Tajweed", tilawa: "Tilawa",
  qiraat: "Qiraat", tafsir: "Tafsir", combined: "Hifz + Review", other: "Other",
};
import { VideoRoom } from "@/app/student/sessions/[id]/video-room";
import { PostSessionForm } from "./post-session-form";
import { SessionDetailControls } from "./session-detail-controls";
import { LessonPlanPanel } from "./lesson-plan-panel";
import { HomeworkAssignmentForm } from "@/components/shared/homework-assignment-form";
import { AddStudentControl } from "./add-student-control";
import type { LessonPlan } from "@/lib/actions/session-lesson-plan";
import { isFeatureEnabled } from "@/lib/settings";

export const metadata: Metadata = { title: "الجلسة" };

interface Props {
  params: Promise<{ id: string }>;
}

export default async function TeacherSessionPage({ params }: Props) {
  const { id } = await params;
  const { t, dir, lang } = await getT();
  const locale = lang === "ar" ? "ar" : "en-US";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: session } = await supabase
    .from("sessions")
    .select("id, booking_id, room_url, room_name, expires_at, started_at, ended_at, actual_duration, post_session_notes, homework, lesson_plan")
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
      lesson_plan: LessonPlan | null;
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

  const [studentRes, retentionRes] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", booking.student_id)
      .single<{ full_name: string | null }>(),
    supabase.from("retention_signals").select("churn_risk_score").eq("student_id", booking.student_id)
      .maybeSingle<{ churn_risk_score: number | null }>(),
  ]);
  const student = studentRes.data;
  const studentRisk = retentionRes.data?.churn_risk_score ?? null;

  // Fetch structured homework assignments for this booking
  const { data: hwAssignments } = await supabase
    .from("homework_assignments")
    .select("*")
    .eq("booking_id", session.booking_id)
    .order("assigned_at", { ascending: false })
    .returns<HomeworkAssignment[]>();

  // Group-session: list every student enrolled in this session via their
  // own bookings row. The primary booking shows up here too — that's
  // intentional. Single-student sessions just show one entry; we still
  // render the section so the UX is consistent.
  const { data: enrolledRaw } = await supabase
    .from("bookings")
    .select("id, student_id")
    .eq("session_id", session.id)
    .returns<{ id: string; student_id: string }[]>();
  // Defensive: if the session is so freshly created that bookings.session_id
  // hasn't backfilled yet, at least include the primary booking's student.
  const enrolledStudentIds = Array.from(new Set([
    booking.student_id,
    ...((enrolledRaw ?? []).map(b => b.student_id)),
  ]));

  // Lookup names + risk scores in one round-trip each.
  const { data: enrolledProfiles } = enrolledStudentIds.length > 0
    ? await supabase.from("profiles").select("id, full_name").in("id", enrolledStudentIds)
        .returns<{ id: string; full_name: string | null }[]>()
    : { data: [] };
  const enrolledList = (enrolledProfiles ?? []).map((p) => ({
    id: p.id,
    name: p.full_name ?? t("بدون اسم", "Unnamed"),
  }));

  // Candidates for the "Add student" picker: every student the teacher has
  // worked with (any non-deleted booking), minus the ones already enrolled.
  // Using the teacher_id keeps the list scoped — a teacher with 200 students
  // shouldn't pick from a global directory.
  const { data: candidateBookings } = await supabase
    .from("bookings")
    .select("student_id")
    .eq("teacher_id", booking.teacher_id)
    .is("deleted_at", null)
    .returns<{ student_id: string }[]>();
  const candidateIds = Array.from(new Set((candidateBookings ?? []).map(b => b.student_id)));
  const { data: candidateProfiles } = candidateIds.length > 0
    ? await supabase.from("profiles").select("id, full_name").in("id", candidateIds)
        .returns<{ id: string; full_name: string | null }[]>()
    : { data: [] };
  const candidates = (candidateProfiles ?? [])
    .map((p) => ({ id: p.id, name: p.full_name ?? t("بدون اسم", "Unnamed") }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const studentName = student?.full_name || t("الطالب", "Student");
  const scheduledDate = new Date(booking.scheduled_at);
  const isCompleted = session.ended_at !== null;

  return (
    <div dir={dir} className="mx-auto max-w-5xl px-4 py-8">
      <Link
        href="/teacher/sessions"
        className="mb-6 inline-flex items-center gap-1 text-sm text-gold transition-colors hover:text-gold-hover focus-ring"
      >
        <ArrowRight size={14} />
        {t("العودة للجلسات", "Back to Sessions")}
      </Link>

      <div className="glass-card mb-6 flex flex-wrap items-center justify-between gap-4 p-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold">{studentName}</h1>
            {studentRisk != null && studentRisk >= 40 && (
              <span className={`glass-badge ${riskBadgeClass(studentRisk)}`} title={`${t("خطر التسرب", "Churn risk")}: ${studentRisk.toFixed(0)}`}>
                {riskLabel(studentRisk)}
              </span>
            )}
          </div>
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
        {isCompleted && session.actual_duration && (
          <div className="glass glass-pill px-3 py-1 text-sm text-muted">
            {t("مدة الجلسة", "Session duration")}: {session.actual_duration} {t("دقيقة", "min")}
          </div>
        )}
      </div>

      {/* Enrolled students — always shown so the teacher knows who's in the
          session. The Add Student button lets them grow a 1:1 into a group
          ad-hoc (Phase 1 of group lessons). Hidden once the session is
          completed since adding a student to history is not meaningful. */}
      {!isCompleted && (
        <div className="glass-card mb-4 p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-wider text-muted">
              {t("الطلاب المسجَّلون", "Enrolled students")} · {enrolledList.length}
            </p>
            <AddStudentControl
              sessionId={session.id}
              candidates={candidates}
              enrolledIds={enrolledStudentIds}
            />
          </div>
          {enrolledList.length === 0 ? (
            <p className="text-sm text-muted">{t("لا يوجد طلاب", "No students yet")}</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {enrolledList.map((s) => (
                <li
                  key={s.id}
                  className="glass-badge border-gold/30 bg-gold/10 px-3 py-1 text-xs font-medium text-gold"
                >
                  {s.name}
                  {s.id === booking.student_id && enrolledList.length > 1 && (
                    <span className="ms-1 text-[10px] text-gold/60" title={t("الطالب الأصلي", "Primary booking")}>
                      ★
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

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

      {!isCompleted && (await isFeatureEnabled("lesson_plan_enabled")) && (
        <div className="mt-4">
          <LessonPlanPanel sessionId={session.id} initialPlan={session.lesson_plan} />
        </div>
      )}

      {isCompleted ? (
        <PostSessionForm
          sessionId={session.id}
          bookingId={session.booking_id}
          studentId={booking.student_id}
          studentName={studentName}
          existingNotes={session.post_session_notes}
          existingHomework={session.homework}
          existingAssignments={hwAssignments ?? []}
        />
      ) : (
        <>
          <VideoRoom
            sessionId={session.id}
            roomUrl={session.room_url}
            userName={user.user_metadata?.full_name ?? t("معلم", "Teacher")}
            expiresAt={session.expires_at}
            durationMin={booking.duration_min}
          />
          {/* Homework can be assigned at any time, not only post-session.
              Collapsed by default so it doesn't compete with the video room. */}
          <details className="glass-card mt-4 p-4">
            <summary className="cursor-pointer text-sm font-medium">
              {t("اعتماد واجب الآن", "Assign homework now")}
            </summary>
            <div className="mt-3">
              <HomeworkAssignmentForm
                bookingId={session.booking_id}
                studentId={booking.student_id}
                sessionId={session.id}
                existingAssignments={hwAssignments ?? []}
                hideHeader
                defaultOpen
              />
            </div>
          </details>
        </>
      )}
    </div>
  );
}
