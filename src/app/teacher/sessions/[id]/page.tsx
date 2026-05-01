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
    .select("id, booking_id, room_url, room_name, expires_at, started_at, ended_at, actual_duration, post_session_notes, homework, lesson_plan, is_group, capacity")
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
      is_group: boolean;
      capacity: number;
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

  // Group-session: list every student enrolled in this session via their
  // own bookings row. Each enrolled booking has its own homework feed.
  const { data: enrolledRaw } = await supabase
    .from("bookings")
    .select("id, student_id")
    .eq("session_id", session.id)
    .is("deleted_at", null)
    .returns<{ id: string; student_id: string }[]>();
  // Defensive: include the primary booking too so a freshly-created session
  // (where bookings.session_id hasn't been backfilled yet) still shows the
  // primary student.
  const allEnrolledBookings = (() => {
    const seen = new Set((enrolledRaw ?? []).map(b => b.id));
    const out = [...(enrolledRaw ?? [])];
    if (!seen.has(session.booking_id)) {
      out.unshift({ id: session.booking_id, student_id: booking.student_id });
    }
    return out;
  })();
  const enrolledStudentIds = Array.from(new Set(allEnrolledBookings.map(b => b.student_id)));
  const enrolledBookingIds = allEnrolledBookings.map(b => b.id);

  // Names + per-booking homework in two round-trips.
  const [profilesRes, hwRes] = await Promise.all([
    enrolledStudentIds.length > 0
      ? supabase.from("profiles").select("id, full_name").in("id", enrolledStudentIds)
          .returns<{ id: string; full_name: string | null }[]>()
      : Promise.resolve({ data: [] }),
    enrolledBookingIds.length > 0
      ? supabase.from("homework_assignments").select("*").in("booking_id", enrolledBookingIds)
          .order("assigned_at", { ascending: false })
          .returns<HomeworkAssignment[]>()
      : Promise.resolve({ data: [] }),
  ]);
  const profileById = new Map((profilesRes.data ?? []).map(p => [p.id, p.full_name ?? t("بدون اسم", "Unnamed")]));
  const enrolledList = enrolledStudentIds.map((sid) => ({
    id: sid,
    name: profileById.get(sid) ?? t("بدون اسم", "Unnamed"),
  }));
  // Group homework by booking_id for easy per-student lookup downstream.
  const homeworkByBooking = new Map<string, HomeworkAssignment[]>();
  for (const hw of hwRes.data ?? []) {
    const arr = homeworkByBooking.get(hw.booking_id) ?? [];
    arr.push(hw);
    homeworkByBooking.set(hw.booking_id, arr);
  }
  // Build the per-student "card" payload for the post-session form.
  const enrolledForForm = allEnrolledBookings.map((b) => ({
    bookingId: b.id,
    studentId: b.student_id,
    studentName: profileById.get(b.student_id) ?? t("الطالب", "Student"),
    assignments: homeworkByBooking.get(b.id) ?? [],
  }));
  // Legacy single-student feed used by the inline "Assign homework now"
  // panel for in-progress sessions — keep pointing at the primary booking.
  const hwAssignments = homeworkByBooking.get(session.booking_id) ?? [];

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
        <div className="flex flex-wrap items-center gap-2">
          {(session.is_group || enrolledList.length > 1) && (
            <div className="glass glass-pill border-gold/30 bg-gold/10 px-3 py-1 text-xs text-gold">
              {t("جلسة جماعية", "Group session")} · {enrolledList.length}/{session.capacity}
            </div>
          )}
          {isCompleted && session.actual_duration && (
            <div className="glass glass-pill px-3 py-1 text-sm text-muted">
              {t("مدة الجلسة", "Session duration")}: {session.actual_duration} {t("دقيقة", "min")}
            </div>
          )}
        </div>
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
          existingAssignments={hwAssignments}
          enrolled={enrolledForForm}
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
