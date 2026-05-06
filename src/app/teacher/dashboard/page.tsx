import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchNameMap } from "@/lib/supabase/helpers";
import { loadOrFail, countOrFail, helperOrFail } from "@/lib/supabase/load-or-fail";
import { logError } from "@/lib/logger";
import { Skeleton } from "@/components/shared/skeleton";
import type { SessionType } from "@/types/database";
import { TeacherDashboardContent } from "./dashboard-content";
import { TeacherAtRiskStudents } from "./at-risk-students";
import { MentorshipCard, MentorshipCardSkeleton } from "./mentorship-card";
import { DataLoadBanner } from "@/components/shared/data-load-banner";
import {
  getTeacherWeeklyHours,
  getTeacherLiveSessions,
  getTeacherSessionTypeBreakdown,
  getTeacherRecentStudents,
  getTeacherTimeToGrade,
} from "@/lib/dashboard-queries";
import { RosterErrorPulse, RosterErrorPulseSkeleton } from "./roster-error-pulse";
import { TalqeenInboxCard, TalqeenInboxCardSkeleton } from "./talqeen-inbox-card";
import { ParentReportDigestCard, ParentReportDigestCardSkeleton } from "./parent-report-digest-card";
import { RecitationStandardRoster, RecitationStandardRosterSkeleton } from "./recitation-standard-roster";

export const metadata: Metadata = { title: "لوحة المعلم" };

interface PendingBooking { id: string; scheduled_at: string; duration_min: number; session_type: SessionType; amount_usd: number; student_id: string; }

export default async function TeacherDashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

  // Batch 1 — every query depends only on user.id, so they all parallelize.
  // The 4 secondary widgets (talqeen, roster-error-pulse, parent-report,
  // recitation-roster) used to live in this batch too; they moved into
  // self-fetching components rendered inside <Suspense> so first-paint
  // ships at TTFB ~200 ms instead of waiting on slow aggregation queries.
  // overdue-evals also moved out of the legacy fetch+filter pattern into
  // the rpc call below — wraps a NOT EXISTS query in a single round trip.
  const [
    profileRes, tpRes, pendingRes, todayRes, monthRes, allStudentsRes, availRes,
    gradingRes, convosRes,
    weeklyHoursLoad, liveSessionsLoad, sessionBreakdownLoad, recentStudentsLoad, timeToGradeLoad,
    overdueEvalsRes,
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
    // Single-RPC replacement for the previous two-step fetch+filter pattern.
    // The function (migration 20260505205251) does NOT EXISTS in Postgres
    // and returns the count directly. The Supabase generated types lag the
    // migration; cast to `never` until db:types regenerates after CI applies
    // the migration.
    supabase.rpc(
      "get_teacher_overdue_eval_count" as never,
      { p_teacher_id: user.id } as never,
    ) as unknown as Promise<{ data: number | null; error: { message: string; code?: string } | null }>,
  ]);

  type SessionRow = { id: string; booking_id: string; room_url: string; expires_at: string | null; started_at: string | null; ended_at: string | null };

  // loadOrFail/countOrFail wrap the direct supabase queries in this batch so
  // each failure tags Sentry with the dashboard widget that broke. anyFailed
  // accumulates across the whole page → drives <DataLoadBanner /> below. The
  // 4 streamed widgets (talqeen, roster-error-pulse, parent-report,
  // recitation-roster) handle their own failures inside the components via
  // helperOrFail, so they're NOT in this aggregation.
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
  let anyFailed = profileLoad.failed || tpLoad.failed || pendingLoad.failed
    || todayLoad.failed || allStudentsLoad.failed || convosLoad.failed
    || monthLoad.failed || availLoad.failed || gradingLoad.failed
    || weeklyHoursLoad.failed || liveSessionsLoad.failed
    || sessionBreakdownLoad.failed || recentStudentsLoad.failed || timeToGradeLoad.failed;

  // Sprint 2.1 (2026-05-05) overdue-evals count — a single RPC call resolved
  // inside batch 1 instead of two sequential round-trips + JS filter. Same
  // gate semantics as dashboard/actions.ts (CONFIRM-booking gate).
  if (overdueEvalsRes.error) {
    logError("teacher-dashboard.overdue-evals rpc failed", overdueEvalsRes.error, {
      tag: "data-load",
      severity: "warning",
      route: "teacher-dashboard",
      metadata: { widget: "overdue-evals" },
    });
    anyFailed = true;
  }
  const overdueEvalsCount = (overdueEvalsRes.data as number | null) ?? 0;

  // Batch 2 — two queries that need batch-1 results (conv ids, today's
  // booking ids) but are independent of each other. Previously these ran
  // serially after batch 1; now parallel = 1 RT instead of 2. Empty `in()`
  // arrays are safe in Supabase — PostgREST returns no rows without error,
  // matching the prior "skip when empty" behavior.
  const convIds = convosLoad.data.map(c => c.id);
  const todayBookingIds = todayLoad.data.map(b => b.id);
  const [messagesRes, sessionsRes] = await Promise.all([
    supabase.from("messages").select("id", { count: "exact", head: true })
      .in("conversation_id", convIds)
      .neq("sender_id", user.id)
      .eq("is_read", false),
    supabase.from("sessions")
      .select("id, booking_id, room_url, expires_at, started_at, ended_at")
      .in("booking_id", todayBookingIds)
      .returns<SessionRow[]>(),
  ]);

  const messagesLoad = countOrFail(messagesRes, { route: "teacher-dashboard", widget: "unread-messages" });
  const sessionsLoad = loadOrFail(sessionsRes, [] as SessionRow[], { route: "teacher-dashboard", widget: "today-session-data" });
  anyFailed = anyFailed || messagesLoad.failed || sessionsLoad.failed;

  const unreadMessages = messagesLoad.count;
  const pendingGrading = gradingLoad.count;

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
      {/* The four bottom-section widgets stream in via <Suspense>.
          The page shell + TeacherDashboardContent above paint at TTFB
          ~200 ms; each widget renders its skeleton while its dedicated
          aggregation query runs, then swaps in the real content as it
          resolves. Graceful: a widget whose data load fails still renders
          its empty/error state (helperOrFail inside each component). */}
      <div className="mx-auto max-w-7xl px-4 pb-2 sm:px-6">
        <Suspense fallback={<TalqeenInboxCardSkeleton />}>
          <TalqeenInboxCard teacherId={user.id} />
        </Suspense>
      </div>

      <div className="mx-auto max-w-7xl px-4 pb-2 sm:px-6">
        <Suspense fallback={<RosterErrorPulseSkeleton />}>
          <RosterErrorPulse teacherId={user.id} />
        </Suspense>
      </div>

      <div className="mx-auto max-w-7xl px-4 pb-2 sm:px-6">
        <Suspense fallback={<ParentReportDigestCardSkeleton />}>
          <ParentReportDigestCard teacherId={user.id} />
        </Suspense>
      </div>

      <div className="mx-auto max-w-7xl px-4 pb-2 sm:px-6">
        <Suspense fallback={<RecitationStandardRosterSkeleton />}>
          <RecitationStandardRoster teacherId={user.id} />
        </Suspense>
      </div>

      {cvStatus === "approved" && (
        <div className="mx-auto max-w-7xl px-4 pb-8 sm:px-6">
          {/* AtRiskStudents was already self-fetching; just wrap in
              Suspense so its 90-day-bookings + retention_signals + names
              fan-out doesn't block first paint. */}
          <Suspense
            fallback={
              <div className="glass-card mt-4 rounded-xl p-4" aria-hidden="true">
                <Skeleton className="mb-3 h-4 w-48" />
                <div className="space-y-2">
                  <Skeleton className="h-12 w-full rounded-lg" />
                  <Skeleton className="h-12 w-full rounded-lg" />
                </div>
              </div>
            }
          >
            <TeacherAtRiskStudents teacherId={user.id} />
          </Suspense>
        </div>
      )}

      {/* Mentorship card — renders only when this teacher has an active
          mentor relationship in either direction. Pairings are admin-
          driven for now. Wrapped in Suspense so its 3 sequential queries
          (mentorships, profiles, feedback) don't block the page tail. */}
      <Suspense fallback={<MentorshipCardSkeleton />}>
        <MentorshipCard teacherId={user.id} />
      </Suspense>
    </main>
  );
}
