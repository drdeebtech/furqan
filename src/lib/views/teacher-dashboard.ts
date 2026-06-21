import { createClient } from "@/lib/supabase/server";
import { buildNameMap } from "@/lib/admin/name-map";
import { loadOrFail, countOrFail, helperOrFail } from "@/lib/supabase/load-or-fail";
import { logError } from "@/lib/logger";
import {
  getTeacherWeeklyHours,
  getTeacherLiveSessions,
  getTeacherSessionTypeBreakdown,
  getTeacherRecentStudents,
  getTeacherTimeToGrade,
} from "@/lib/dashboard-queries";
import type { PendingBooking, SessionData } from "@/app/teacher/dashboard/types";

/**
 * Deep read module for the teacher dashboard screen.
 *
 * Owns the full read-assembly for `/teacher/dashboard` behind one interface
 * so the page component becomes a thin HTTP-boundary + render shell.
 * The injected `supabase` client is the test seam — tests can pass a
 * stub/fake without a live server client.
 *
 * Behavior-preserving: pure reads-only refactor. All query logic, the
 * Kuwait timezone anchor, batch structure, and error accumulation are
 * identical to the page implementation this replaces.
 */

type ServerClient = Awaited<ReturnType<typeof createClient>>;

const ROUTE = "teacher-dashboard";

// Kuwait operator timezone — the page's original comment explains why
// this is hard-coded (no DST, static +03:00 offset is safe).
const TZ_OFFSET = "+03:00";
const TZ = "Asia/Kuwait";

type SessionRow = {
  id: string;
  booking_id: string;
  room_url: string;
  expires_at: string | null;
  started_at: string | null;
  ended_at: string | null;
};

export interface TeacherDashboardData {
  fullName: string | null;
  cvStatus: "draft" | "pending_review" | "approved" | "rejected";
  hasProfile: boolean;
  hasBio: boolean;
  hasAvailability: boolean;
  uniqueStudents: number;
  monthSessions: number;
  pendingCount: number;
  ratingAvg: number;
  todaySessions: PendingBooking[];
  pending: PendingBooking[];
  sessionDataMap: Record<string, SessionData>;
  nameMap: Record<string, string>;
  weeklyHours: Awaited<ReturnType<typeof getTeacherWeeklyHours>>;
  liveSessions: Awaited<ReturnType<typeof getTeacherLiveSessions>>;
  sessionBreakdown: Awaited<ReturnType<typeof getTeacherSessionTypeBreakdown>>;
  recentStudents: Awaited<ReturnType<typeof getTeacherRecentStudents>>;
  actionQueue: {
    pendingGrading: number;
    overdueEvals: number;
    unreadMessages: number;
    todaySessionCount: number;
    lowAvailability: boolean;
  };
  timeToGrade: Awaited<ReturnType<typeof getTeacherTimeToGrade>>;
}

export interface TeacherDashboardViewResult {
  data: TeacherDashboardData;
  /** True if ANY read on the page failed — drives the DataLoadBanner. */
  anyFailed: boolean;
}

/**
 * Assemble the full read bundle for the teacher dashboard.
 *
 * @param supabase   Injected server client (the test seam — page passes the real one).
 * @param teacherId  The authenticated teacher's user id.
 */
export async function teacherDashboardView(
  supabase: ServerClient,
  teacherId: string,
): Promise<TeacherDashboardViewResult> {
  // Anchor "today" to Asia/Kuwait (operator timezone) — same logic as the
  // original page. Kuwait has no DST so the static +03:00 offset is safe.
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const todayStart = new Date(`${dateParts}T00:00:00${TZ_OFFSET}`);
  const todayEnd = new Date(`${dateParts}T23:59:59.999${TZ_OFFSET}`);
  const monthParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
  const monthStart = new Date(`${monthParts}-01T00:00:00${TZ_OFFSET}`).toISOString();

  // ── Batch 1: all queries that depend only on teacherId ──────────────────
  const [
    profileRes, tpRes, pendingRes, todayRes, monthRes, allStudentsRes, availRes,
    gradingRes, convosRes,
    weeklyHoursLoad, liveSessionsLoad, sessionBreakdownLoad, recentStudentsLoad, timeToGradeLoad,
    overdueEvalsRes,
  ] = await Promise.all([
    supabase.from("profiles").select("full_name, phone, avatar_url").eq("id", teacherId)
      .single<{ full_name: string | null; phone: string | null; avatar_url: string | null }>(),
    supabase.from("teacher_profiles").select("total_sessions, rating_avg, cv_status, bio").eq("teacher_id", teacherId)
      .single<{ total_sessions: number; rating_avg: number; cv_status: string; bio: string | null }>(),
    supabase.from("bookings").select("id, scheduled_at, duration_min, session_type, amount_usd, student_id")
      .eq("teacher_id", teacherId).eq("status", "pending").order("scheduled_at", { ascending: true })
      .returns<PendingBooking[]>(),
    supabase.from("bookings").select("id, scheduled_at, duration_min, session_type, student_id")
      .eq("teacher_id", teacherId).eq("status", "confirmed")
      .gte("scheduled_at", todayStart.toISOString()).lte("scheduled_at", todayEnd.toISOString())
      .order("scheduled_at", { ascending: true }).returns<PendingBooking[]>(),
    supabase.from("bookings").select("id", { count: "exact", head: true })
      .eq("teacher_id", teacherId).eq("status", "completed").gte("created_at", monthStart),
    supabase.rpc("teacher_distinct_students" as never, { p_teacher_id: teacherId } as never)
      .returns<{ student_id: string }[]>(),
    supabase.from("teacher_availability").select("id", { count: "exact", head: true })
      .eq("teacher_id", teacherId).eq("is_active", true),
    supabase.from("homework_assignments").select("id", { count: "exact", head: true })
      .eq("teacher_id", teacherId).eq("status", "student_ready"),
    supabase.from("conversations").select("id").eq("teacher_id", teacherId).returns<{ id: string }[]>(),
    helperOrFail(
      () => getTeacherWeeklyHours(teacherId),
      [],
      { route: ROUTE, widget: "weekly-hours" },
    ),
    helperOrFail(
      () => getTeacherLiveSessions(teacherId),
      [],
      { route: ROUTE, widget: "live-sessions" },
    ),
    helperOrFail(
      () => getTeacherSessionTypeBreakdown(teacherId),
      [],
      { route: ROUTE, widget: "session-breakdown" },
    ),
    helperOrFail(
      () => getTeacherRecentStudents(teacherId),
      [],
      { route: ROUTE, widget: "recent-students" },
    ),
    helperOrFail(
      () => getTeacherTimeToGrade(teacherId),
      { medianHours: null, p90Hours: null, sampleSize: 0 },
      { route: ROUTE, widget: "time-to-grade" },
    ),
    supabase.rpc(
      "get_teacher_overdue_eval_count" as never,
      { p_teacher_id: teacherId } as never,
    ) as unknown as Promise<{ data: number | null; error: { message: string; code?: string } | null }>,
  ]);

  const profileLoad = loadOrFail(profileRes, { full_name: null, phone: null, avatar_url: null }, { route: ROUTE, widget: "profile" });
  const tpLoad = loadOrFail(tpRes, { total_sessions: 0, rating_avg: 0, cv_status: "draft", bio: null }, { route: ROUTE, widget: "teacher-profile" });
  const pendingLoad = loadOrFail(pendingRes, [] as PendingBooking[], { route: ROUTE, widget: "pending-bookings" });
  const todayLoad = loadOrFail(todayRes, [] as PendingBooking[], { route: ROUTE, widget: "today-sessions" });
  const allStudentsLoad = loadOrFail(allStudentsRes, [] as { student_id: string }[], { route: ROUTE, widget: "all-students" });
  const convosLoad = loadOrFail(convosRes, [] as { id: string }[], { route: ROUTE, widget: "conversations" });
  const monthLoad = countOrFail(monthRes, { route: ROUTE, widget: "month-sessions" });
  const availLoad = countOrFail(availRes, { route: ROUTE, widget: "active-availability" });
  const gradingLoad = countOrFail(gradingRes, { route: ROUTE, widget: "pending-grading" });

  let anyFailed = profileLoad.failed || tpLoad.failed || pendingLoad.failed
    || todayLoad.failed || allStudentsLoad.failed || convosLoad.failed
    || monthLoad.failed || availLoad.failed || gradingLoad.failed
    || weeklyHoursLoad.failed || liveSessionsLoad.failed
    || sessionBreakdownLoad.failed || recentStudentsLoad.failed || timeToGradeLoad.failed;

  if (overdueEvalsRes.error) {
    logError("teacher-dashboard.overdue-evals rpc failed", overdueEvalsRes.error, {
      tag: "data-load",
      severity: "warning",
      route: ROUTE,
      metadata: { widget: "overdue-evals" },
    });
    anyFailed = true;
  }
  const overdueEvalsCount = (overdueEvalsRes.data as number | null) ?? 0;

  // ── Batch 2: reads that depend on batch-1 results ──────────────────────
  const convIds = convosLoad.data.map(c => c.id);
  const todayBookingIds = todayLoad.data.map(b => b.id);
  const [messagesRes, sessionsRes] = await Promise.all([
    supabase.from("messages").select("id", { count: "exact", head: true })
      .in("conversation_id", convIds)
      .neq("sender_id", teacherId)
      .eq("is_read", false),
    supabase.from("sessions")
      .select("id, booking_id, room_url, expires_at, started_at, ended_at")
      .in("booking_id", todayBookingIds)
      .returns<SessionRow[]>(),
  ]);

  const messagesLoad = countOrFail(messagesRes, { route: ROUTE, widget: "unread-messages" });
  const sessionsLoad = loadOrFail(sessionsRes, [] as SessionRow[], { route: ROUTE, widget: "today-session-data" });
  anyFailed = anyFailed || messagesLoad.failed || sessionsLoad.failed;

  // ── Derived values ──────────────────────────────────────────────────────
  const pending = pendingLoad.data;
  const todaySessions = todayLoad.data;
  const hasAvailability = availLoad.count > 0;

  const sessionDataMap: Record<string, SessionData> = sessionsLoad.data.length > 0
    ? Object.fromEntries(sessionsLoad.data.map(({ booking_id, ...rest }) => [booking_id, rest]))
    : {};

  const allStudentIds = [...new Set([...pending.map(b => b.student_id), ...todaySessions.map(b => b.student_id)])];
  const nameMap = await buildNameMap(supabase, allStudentIds);

  return {
    data: {
      fullName: profileLoad.data.full_name,
      cvStatus: (tpLoad.data.cv_status ?? "draft") as "draft" | "pending_review" | "approved" | "rejected",
      hasProfile: !!(profileLoad.data.full_name && profileLoad.data.phone && profileLoad.data.avatar_url),
      hasBio: !!(tpLoad.data.bio),
      hasAvailability,
      uniqueStudents: new Set(allStudentsLoad.data.map(s => s.student_id)).size,
      monthSessions: monthLoad.count,
      pendingCount: pending.length,
      ratingAvg: Number(tpLoad.data.rating_avg ?? 0),
      todaySessions,
      pending,
      sessionDataMap,
      nameMap,
      weeklyHours: weeklyHoursLoad.data,
      liveSessions: liveSessionsLoad.data,
      sessionBreakdown: sessionBreakdownLoad.data,
      recentStudents: recentStudentsLoad.data,
      actionQueue: {
        pendingGrading: gradingLoad.count,
        overdueEvals: overdueEvalsCount,
        unreadMessages: messagesLoad.count,
        todaySessionCount: todaySessions.length,
        lowAvailability: !hasAvailability,
      },
      timeToGrade: timeToGradeLoad.data,
    },
    anyFailed,
  };
}
