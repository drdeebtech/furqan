import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchNameMap } from "@/lib/supabase/helpers";
import { loadOrFail, countOrFail } from "@/lib/supabase/load-or-fail";
import type { SessionType } from "@/types/database";
import { TeacherDashboardContent } from "./dashboard-content";
import { TeacherAtRiskStudents } from "./at-risk-students";
import { MentorshipCard } from "./mentorship-card";
import { DataLoadBanner } from "@/components/shared/data-load-banner";
import {
  getTeacherWeeklyHours,
  getTeacherLiveSessions,
  getTeacherSessionTypeBreakdown,
  getTeacherRecentStudents,
  getTeacherTimeToGrade,
  getTeacherRosterErrorPulse,
  getTeacherTalqeenInbox,
} from "@/lib/dashboard-queries";
import { RosterErrorPulse } from "./roster-error-pulse";
import { TalqeenInboxCard } from "./talqeen-inbox-card";

export const metadata: Metadata = { title: "لوحة المعلم" };

interface PendingBooking { id: string; scheduled_at: string; duration_min: number; session_type: SessionType; amount_usd: number; student_id: string; }

export default async function TeacherDashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

  // One big parallel batch — every query below only depends on user.id, so we
  // collapse what was previously three sequential round-trips down to two.
  // The remaining sequential hop is the unread-messages count, which has a
  // legit dependency on the conversation ids returned by convosRes.
  const [
    profileRes, tpRes, pendingRes, todayRes, monthRes, allStudentsRes, availRes,
    gradingRes, convosRes,
    weeklyHours, liveSessions, sessionBreakdown, recentStudents, timeToGrade,
    rosterErrorPulse, talqeenInbox,
  ] = await Promise.all([
    supabase.from("profiles").select("full_name, phone, avatar_url").eq("id", user.id).single<{ full_name: string | null; phone: string | null; avatar_url: string | null }>(),
    supabase.from("teacher_profiles").select("total_sessions, rating_avg, cv_status, bio").eq("teacher_id", user.id)
      .single<{ total_sessions: number; rating_avg: number; cv_status: string; bio: string | null }>(),
    supabase.from("bookings").select("id, scheduled_at, duration_min, session_type, amount_usd, student_id")
      .eq("teacher_id", user.id).eq("status", "pending").order("scheduled_at", { ascending: true }).returns<PendingBooking[]>(),
    supabase.from("bookings").select("id, scheduled_at, duration_min, session_type, student_id")
      .eq("teacher_id", user.id).eq("status", "confirmed")
      .gte("scheduled_at", todayStart.toISOString()).lte("scheduled_at", todayEnd.toISOString())
      .order("scheduled_at", { ascending: true }).returns<PendingBooking[]>(),
    supabase.from("bookings").select("id", { count: "exact", head: true }).eq("teacher_id", user.id).eq("status", "completed").gte("created_at", monthStart),
    // F6: align with /teacher/students — a student with confirmed (not yet
    // completed) bookings is still the teacher's student. The narrower
    // status='completed' filter caused the dashboard to under-count by one
    // for any newly-confirmed but unfinished booking relationship.
    supabase.from("bookings").select("student_id").eq("teacher_id", user.id).in("status", ["confirmed", "completed"]).returns<{ student_id: string }[]>(),
    supabase.from("teacher_availability").select("id", { count: "exact", head: true }).eq("teacher_id", user.id).eq("is_active", true),
    supabase.from("homework_assignments").select("id", { count: "exact", head: true }).eq("teacher_id", user.id).eq("status", "student_ready"),
    supabase.from("conversations").select("id").eq("teacher_id", user.id).returns<{id:string}[]>(),
    getTeacherWeeklyHours(user.id),
    getTeacherLiveSessions(user.id),
    getTeacherSessionTypeBreakdown(user.id),
    getTeacherRecentStudents(user.id),
    getTeacherTimeToGrade(user.id),
    getTeacherRosterErrorPulse(user.id),
    getTeacherTalqeenInbox(user.id),
  ]);

  // loadOrFail/countOrFail wrap the direct supabase queries in this batch so
  // each failure tags Sentry with the dashboard widget that broke. anyFailed
  // accumulates across the whole page → drives <DataLoadBanner /> below.
  const profileLoad = loadOrFail(profileRes, { full_name: null, phone: null, avatar_url: null }, { route: "teacher-dashboard", widget: "profile" });
  const tpLoad = loadOrFail(tpRes, { total_sessions: 0, rating_avg: 0, cv_status: "draft", bio: null }, { route: "teacher-dashboard", widget: "teacher-profile" });
  const pendingLoad = loadOrFail(pendingRes, [] as PendingBooking[], { route: "teacher-dashboard", widget: "pending-bookings" });
  const todayLoad = loadOrFail(todayRes, [] as PendingBooking[], { route: "teacher-dashboard", widget: "today-sessions" });
  const allStudentsLoad = loadOrFail(allStudentsRes, [] as { student_id: string }[], { route: "teacher-dashboard", widget: "all-students" });
  const convosLoad = loadOrFail(convosRes, [] as { id: string }[], { route: "teacher-dashboard", widget: "conversations" });
  // Count-only queries — countOrFail returns { count, failed } so we don't
  // have to read .count separately from the original Res object.
  const monthLoad = countOrFail(monthRes, { route: "teacher-dashboard", widget: "month-sessions" });
  const availLoad = countOrFail(availRes, { route: "teacher-dashboard", widget: "active-availability" });
  const gradingLoad = countOrFail(gradingRes, { route: "teacher-dashboard", widget: "pending-grading" });
  // anyFailed must be `let` because the unread-messages and today-session-data
  // loads run sequentially below and OR their flags in.
  let anyFailed = profileLoad.failed || tpLoad.failed || pendingLoad.failed
    || todayLoad.failed || allStudentsLoad.failed || convosLoad.failed
    || monthLoad.failed || availLoad.failed || gradingLoad.failed;

  const convIds = convosLoad.data.map(c => c.id);
  let unreadMessages = 0;
  if (convIds.length > 0) {
    const messagesRes = await supabase.from("messages").select("id", { count: "exact", head: true })
      .in("conversation_id", convIds).neq("sender_id", user.id).eq("is_read", false);
    const messagesLoad = countOrFail(messagesRes, { route: "teacher-dashboard", widget: "unread-messages" });
    unreadMessages = messagesLoad.count;
    anyFailed = anyFailed || messagesLoad.failed;
  }
  const pendingGrading = gradingLoad.count;

  // Sprint 2.1 (2026-05-05): proactive eval-discipline count.
  // Mirrors the same 2-step query that dashboard/actions.ts uses for the
  // CONFIRM-booking gate (lines 54–80). Surfacing the count here lets the
  // teacher clear their backlog *before* the gate hardens on 2026-05-19
  // instead of getting blocked at confirm time. PostgREST has no clean
  // NOT EXISTS — same fetch-and-filter pattern as the gate.
  const sevenDaysAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const oldCompletedRes = await supabase.from("bookings")
    .select("id, student_id, scheduled_at")
    .eq("teacher_id", user.id)
    .eq("status", "completed")
    .lt("scheduled_at", sevenDaysAgoIso)
    .returns<{ id: string; student_id: string; scheduled_at: string }[]>();
  const oldCompletedLoad = loadOrFail(
    oldCompletedRes,
    [] as { id: string; student_id: string; scheduled_at: string }[],
    { route: "teacher-dashboard", widget: "overdue-evals-bookings" },
  );
  anyFailed = anyFailed || oldCompletedLoad.failed;

  let overdueEvalsCount = 0;
  if (oldCompletedLoad.data.length > 0) {
    const studentIds = [...new Set(oldCompletedLoad.data.map(b => b.student_id))];
    const evalsRes = await supabase.from("session_evaluations")
      .select("student_id, created_at")
      .eq("teacher_id", user.id)
      .in("student_id", studentIds)
      .returns<{ student_id: string; created_at: string }[]>();
    const evalsLoad = loadOrFail(
      evalsRes,
      [] as { student_id: string; created_at: string }[],
      { route: "teacher-dashboard", widget: "overdue-evals-evaluations" },
    );
    anyFailed = anyFailed || evalsLoad.failed;
    overdueEvalsCount = oldCompletedLoad.data.filter(b => {
      const matchingEval = evalsLoad.data.find(
        e => e.student_id === b.student_id && new Date(e.created_at) > new Date(b.scheduled_at),
      );
      return !matchingEval;
    }).length;
  }

  const fullName = profileLoad.data.full_name;
  const hasProfile = !!(profileLoad.data.full_name && profileLoad.data.phone && profileLoad.data.avatar_url);
  const hasBio = !!(tpLoad.data.bio);
  const hasAvailability = availLoad.count > 0;
  const ratingAvg = Number(tpLoad.data.rating_avg ?? 0);
  const cvStatus = (tpLoad.data.cv_status ?? "draft") as "draft" | "pending_review" | "approved" | "rejected";
  const pending = pendingLoad.data;
  const todaySessions = todayLoad.data;
  const monthSessions = monthLoad.count;
  const uniqueStudents = new Set(allStudentsLoad.data.map(s => s.student_id)).size;

  let sessionDataMap: Record<string, { id: string; room_url: string; expires_at: string | null; started_at: string | null; ended_at: string | null }> = {};
  if (todaySessions.length > 0) {
    const bIds = todaySessions.map(b => b.id);
    const sessionsRes = await supabase.from("sessions")
      .select("id, booking_id, room_url, expires_at, started_at, ended_at")
      .in("booking_id", bIds)
      .returns<{ id: string; booking_id: string; room_url: string; expires_at: string | null; started_at: string | null; ended_at: string | null }[]>();
    const sessionsLoad = loadOrFail(sessionsRes, [] as { id: string; booking_id: string; room_url: string; expires_at: string | null; started_at: string | null; ended_at: string | null }[], { route: "teacher-dashboard", widget: "today-session-data" });
    anyFailed = anyFailed || sessionsLoad.failed;
    if (sessionsLoad.data.length > 0) {
      sessionDataMap = Object.fromEntries(sessionsLoad.data.map(s => [s.booking_id, s]));
    }
  }

  const allStudentIds = [...new Set([...pending.map(b => b.student_id), ...todaySessions.map(b => b.student_id)])];
  const nameMap = await fetchNameMap(supabase, allStudentIds);

  return (
    <main>
      <DataLoadBanner failed={anyFailed} />
      <TeacherDashboardContent
        data={{
          fullName,
          cvStatus,
          hasProfile,
          hasBio,
          hasAvailability,
          uniqueStudents,
          monthSessions,
          pendingCount: pending.length,
          ratingAvg,
          todaySessions,
          pending,
          sessionDataMap,
          nameMap,
          weeklyHours,
          liveSessions,
          sessionBreakdown,
          recentStudents,
          actionQueue: {
            pendingGrading,
            overdueEvals: overdueEvalsCount,
            unreadMessages,
            todaySessionCount: todaySessions.length,
            lowAvailability: !hasAvailability,
          },
          timeToGrade,
        }}
      />
      {/* Talqeen Audio Inbox — Sprint Improvement #2 (2026-05-05).
          Surfaces recitation-type follow-ups (Sprint 2.3) so the
          platform's most pedagogically distinctive workflow has its
          own surface instead of merging into generic grading. Shown
          for ALL teachers — empty state copy nudges newer teachers. */}
      <div className="mx-auto max-w-6xl px-4 pb-2 sm:px-6">
        <TalqeenInboxCard data={talqeenInbox} />
      </div>

      {/* Roster-wide recitation-error pulse — Sprint Improvement #3
          (2026-05-05). Shown for ALL teachers (not gated by cvStatus)
          because newer teachers benefit from the empty-state nudge to
          start logging errors during sessions. */}
      <div className="mx-auto max-w-6xl px-4 pb-2 sm:px-6">
        <RosterErrorPulse data={rosterErrorPulse} />
      </div>

      {cvStatus === "approved" && (
        <div className="mx-auto max-w-6xl px-4 pb-8 sm:px-6">
          <TeacherAtRiskStudents teacherId={user.id} />
        </div>
      )}

      {/* Mentorship card — renders only when this teacher has an active
          mentor relationship in either direction. Pairings are admin-
          driven for now. */}
      <MentorshipCard teacherId={user.id} />
    </main>
  );
}
