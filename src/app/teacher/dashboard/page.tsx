import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchNameMap } from "@/lib/supabase/helpers";
import { loadOrFail, countOrFail, helperOrFail } from "@/lib/supabase/load-or-fail";
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
  getTeacherParentReportDigest,
  getTeacherRecitationStandardRoster,
} from "@/lib/dashboard-queries";
import { RosterErrorPulse } from "./roster-error-pulse";
import { TalqeenInboxCard } from "./talqeen-inbox-card";
import { ParentReportDigestCard } from "./parent-report-digest-card";
import { RecitationStandardRoster } from "./recitation-standard-roster";

export const metadata: Metadata = { title: "لوحة المعلم" };

interface PendingBooking { id: string; scheduled_at: string; duration_min: number; session_type: SessionType; amount_usd: number; student_id: string; }

export default async function TeacherDashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const sevenDaysAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Batch 1 — every query here depends only on user.id, so they all parallelize.
  // oldCompletedRes used to run sequentially after this batch; pulled in here
  // because the only thing it needs is user.id + sevenDaysAgoIso → free RT save.
  const [
    profileRes, tpRes, pendingRes, todayRes, monthRes, allStudentsRes, availRes,
    gradingRes, convosRes,
    weeklyHoursLoad, liveSessionsLoad, sessionBreakdownLoad, recentStudentsLoad, timeToGradeLoad,
    rosterErrorPulseLoad, talqeenInboxLoad, parentReportDigestLoad, recitationRosterLoad,
    oldCompletedRes,
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
    helperOrFail(
      () => getTeacherWeeklyHours(user.id),
      [],
      { route: "teacher-dashboard", widget: "weekly-hours" },
    ),
    helperOrFail(
      () => getTeacherLiveSessions(user.id),
      [],
      { route: "teacher-dashboard", widget: "live-sessions" },
    ),
    helperOrFail(
      () => getTeacherSessionTypeBreakdown(user.id),
      [],
      { route: "teacher-dashboard", widget: "session-breakdown" },
    ),
    helperOrFail(
      () => getTeacherRecentStudents(user.id),
      [],
      { route: "teacher-dashboard", widget: "recent-students" },
    ),
    helperOrFail(
      () => getTeacherTimeToGrade(user.id),
      { medianHours: null, p90Hours: null, sampleSize: 0 },
      { route: "teacher-dashboard", widget: "time-to-grade" },
    ),
    helperOrFail(
      () => getTeacherRosterErrorPulse(user.id),
      [],
      { route: "teacher-dashboard", widget: "roster-error-pulse" },
    ),
    helperOrFail(
      () => getTeacherTalqeenInbox(user.id),
      { totalCount: 0, recent: [] },
      { route: "teacher-dashboard", widget: "talqeen-inbox" },
    ),
    helperOrFail(
      () => getTeacherParentReportDigest(user.id),
      { totalCount: 0, byType: [] as { type: string; count: number }[], recent: [] as { id: string; reportType: string; studentName: string; createdAt: string; sent: boolean }[] },
      { route: "teacher-dashboard", widget: "parent-report-digest" },
    ),
    helperOrFail(
      () => getTeacherRecitationStandardRoster(user.id),
      [],
      { route: "teacher-dashboard", widget: "recitation-standard-roster" },
    ),
    supabase.from("bookings")
      .select("id, student_id, scheduled_at")
      .eq("teacher_id", user.id)
      .eq("status", "completed")
      .lt("scheduled_at", sevenDaysAgoIso)
      .returns<{ id: string; student_id: string; scheduled_at: string }[]>(),
  ]);

  type SessionRow = { id: string; booking_id: string; room_url: string; expires_at: string | null; started_at: string | null; ended_at: string | null };

  // loadOrFail/countOrFail wrap the direct supabase queries in this batch so
  // each failure tags Sentry with the dashboard widget that broke. anyFailed
  // accumulates across the whole page → drives <DataLoadBanner /> below.
  const profileLoad = loadOrFail(profileRes, { full_name: null, phone: null, avatar_url: null }, { route: "teacher-dashboard", widget: "profile" });
  const tpLoad = loadOrFail(tpRes, { total_sessions: 0, rating_avg: 0, cv_status: "draft", bio: null }, { route: "teacher-dashboard", widget: "teacher-profile" });
  const pendingLoad = loadOrFail(pendingRes, [] as PendingBooking[], { route: "teacher-dashboard", widget: "pending-bookings" });
  const todayLoad = loadOrFail(todayRes, [] as PendingBooking[], { route: "teacher-dashboard", widget: "today-sessions" });
  const allStudentsLoad = loadOrFail(allStudentsRes, [] as { student_id: string }[], { route: "teacher-dashboard", widget: "all-students" });
  const convosLoad = loadOrFail(convosRes, [] as { id: string }[], { route: "teacher-dashboard", widget: "conversations" });
  const oldCompletedLoad = loadOrFail(
    oldCompletedRes,
    [] as { id: string; student_id: string; scheduled_at: string }[],
    { route: "teacher-dashboard", widget: "overdue-evals-bookings" },
  );
  // Count-only queries — countOrFail returns { count, failed } so we don't
  // have to read .count separately from the original Res object.
  const monthLoad = countOrFail(monthRes, { route: "teacher-dashboard", widget: "month-sessions" });
  const availLoad = countOrFail(availRes, { route: "teacher-dashboard", widget: "active-availability" });
  const gradingLoad = countOrFail(gradingRes, { route: "teacher-dashboard", widget: "pending-grading" });
  // anyFailed must be `let` because batch 2 below ORs in its own load flags.
  let anyFailed = profileLoad.failed || tpLoad.failed || pendingLoad.failed
    || todayLoad.failed || allStudentsLoad.failed || convosLoad.failed
    || monthLoad.failed || availLoad.failed || gradingLoad.failed
    || weeklyHoursLoad.failed || liveSessionsLoad.failed
    || sessionBreakdownLoad.failed || recentStudentsLoad.failed || timeToGradeLoad.failed
    || rosterErrorPulseLoad.failed || talqeenInboxLoad.failed
    || parentReportDigestLoad.failed || recitationRosterLoad.failed
    || oldCompletedLoad.failed;

  // Batch 2 — three queries that need batch-1 results (conv ids, today's
  // booking ids, overdue student ids) but are independent of each other.
  // Previously these ran serially after batch 1; now parallel = 1 RT instead
  // of 3. Empty `in()` arrays are safe in Supabase — PostgREST returns no
  // rows without error, matching the prior "skip when empty" behavior.
  const convIds = convosLoad.data.map(c => c.id);
  const todayBookingIds = todayLoad.data.map(b => b.id);
  const overdueStudentIds = [...new Set(oldCompletedLoad.data.map(b => b.student_id))];
  const [messagesRes, evalsRes, sessionsRes] = await Promise.all([
    supabase.from("messages").select("id", { count: "exact", head: true })
      .in("conversation_id", convIds)
      .neq("sender_id", user.id)
      .eq("is_read", false),
    supabase.from("session_evaluations")
      .select("student_id, created_at")
      .eq("teacher_id", user.id)
      .in("student_id", overdueStudentIds)
      .returns<{ student_id: string; created_at: string }[]>(),
    supabase.from("sessions")
      .select("id, booking_id, room_url, expires_at, started_at, ended_at")
      .in("booking_id", todayBookingIds)
      .returns<SessionRow[]>(),
  ]);

  const messagesLoad = countOrFail(messagesRes, { route: "teacher-dashboard", widget: "unread-messages" });
  const evalsLoad = loadOrFail(evalsRes, [] as { student_id: string; created_at: string }[], { route: "teacher-dashboard", widget: "overdue-evals-evaluations" });
  const sessionsLoad = loadOrFail(sessionsRes, [] as SessionRow[], { route: "teacher-dashboard", widget: "today-session-data" });
  anyFailed = anyFailed || messagesLoad.failed || evalsLoad.failed || sessionsLoad.failed;

  const unreadMessages = messagesLoad.count;
  const pendingGrading = gradingLoad.count;

  // Sprint 2.1 (2026-05-05): proactive eval-discipline count. Mirrors the
  // 2-step query in dashboard/actions.ts CONFIRM-booking gate. Surfacing the
  // count here lets the teacher clear their backlog *before* the gate hardens
  // on 2026-05-19. PostgREST has no clean NOT EXISTS — fetch + JS filter.
  const overdueEvalsCount = oldCompletedLoad.data.filter(b => {
    const matchingEval = evalsLoad.data.find(
      e => e.student_id === b.student_id && new Date(e.created_at) > new Date(b.scheduled_at),
    );
    return !matchingEval;
  }).length;

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

  const sessionDataMap: Record<string, Omit<SessionRow, "booking_id">> = sessionsLoad.data.length > 0
    ? Object.fromEntries(sessionsLoad.data.map(({ booking_id, ...rest }) => [booking_id, rest]))
    : {};

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
          weeklyHours: weeklyHoursLoad.data,
          liveSessions: liveSessionsLoad.data,
          sessionBreakdown: sessionBreakdownLoad.data,
          recentStudents: recentStudentsLoad.data,
          actionQueue: {
            pendingGrading,
            overdueEvals: overdueEvalsCount,
            unreadMessages,
            todaySessionCount: todaySessions.length,
            lowAvailability: !hasAvailability,
          },
          timeToGrade: timeToGradeLoad.data,
        }}
      />
      {/* Talqeen Audio Inbox — Sprint Improvement #2 (2026-05-05).
          Surfaces recitation-type follow-ups (Sprint 2.3) so the
          platform's most pedagogically distinctive workflow has its
          own surface instead of merging into generic grading. Shown
          for ALL teachers — empty state copy nudges newer teachers. */}
      <div className="mx-auto max-w-6xl px-4 pb-2 sm:px-6">
        <TalqeenInboxCard data={talqeenInboxLoad.data} />
      </div>

      {/* Roster-wide recitation-error pulse — Sprint Improvement #3
          (2026-05-05). Shown for ALL teachers (not gated by cvStatus)
          because newer teachers benefit from the empty-state nudge to
          start logging errors during sessions. */}
      <div className="mx-auto max-w-6xl px-4 pb-2 sm:px-6">
        <RosterErrorPulse data={rosterErrorPulseLoad.data} />
      </div>

      {/* Parent-report digest — surfaces what's been sent to parents
          on the teacher's behalf this week. Closes the loop between
          the teacher's actions and the parent-communication leg of
          the platform. Honest about delivery-status (sent_at stays
          null until messaging provider is wired). */}
      <div className="mx-auto max-w-6xl px-4 pb-2 sm:px-6">
        <ParentReportDigestCard data={parentReportDigestLoad.data} />
      </div>

      {/* Recitation-standard roster summary — at-a-glance qira'a
          distribution for teachers with multi-tradition rosters,
          plus a nudge to record qira'a for students missing it.
          Component renders nothing when there's no roster data. */}
      <div className="mx-auto max-w-6xl px-4 pb-2 sm:px-6">
        <RecitationStandardRoster data={recitationRosterLoad.data} />
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
