import { after } from "next/server";
import { loadOrFail, countOrFail, helperOrFail } from "@/lib/supabase/load-or-fail";
import type { ServerClient } from "@/lib/supabase/types";
import type { SessionType } from "@/types/database";
import { awardAchievement } from "@/lib/domains/achievements/award";
import { logError } from "@/lib/logger";
import { getGoalDashboardData, type GoalDashboardData } from "@/lib/domains/goals/goals";
import {
  getStudentStudyAnalytics,
  getStudentLiveSessions,
  getStudentRecentRecordings,
  getStudentContinueWatching,
  getStudentNextQuiz,
  getStudentStreak,
  getStudentHomeworkPulse,
  getTodaysMurajaahBatch,
  type MurajaahDueItem,
} from "@/lib/dashboard-queries";

/**
 * Deep read module for the student dashboard screen.
 *
 * This is the *read seam* for `/student/dashboard`: it owns the whole
 * read-assembly that the screen needs (the ~14 raw `supabase.from()` calls
 * plus the 8 `dashboard-queries` god-module helpers, ~25-30 queries/render)
 * behind ONE interface, so the page component goes back to being a thin
 * HTTP-boundary + render shell.
 *
 * Why it exists (50k-scale + testability):
 *  - The page previously did `createClient()` inline, so there was NO test
 *    seam — every read was bound to the live server client. `studentDashboardView`
 *    takes the supabase client as its first argument so the read bundle can be
 *    exercised against a fake/stub client in isolation.
 *  - Consolidating the reads in one place is the prerequisite for auditing the
 *    per-render query count against the 50k DAU read budget.
 *
 * Behavior-preserving: this is a READS-only refactor. The returned bundle is
 * the exact `data` prop `StudentDashboardContent` already consumes, plus the
 * page-level `anyFailed` (DataLoadBanner) and `isNewStudent` (redirect) flags
 * the page used to compute inline. No schema changes; the year-filter / KPI
 * scoping logic is preserved exactly and passed in via {@link StudentDashboardViewOpts}.
 *
 * Streaming: slow queries (analytics chart, live sessions, hwCounts, murajaah,
 * recentRecordings) are moved to independently-awaitable widget functions
 * (`studentAnalyticsWidgetData`, `studentMurajaahWidgetData`) so the page
 * can stream above-fold content without waiting on all ~25-30 queries.
 * The core view retains `continueWatching` so `resumeLesson` (NextActionBanner
 * priority 6) is available above-fold without the analytics slot.
 */

interface ChartDataPoint {
  day: string;
  value: number;
  isActive: boolean;
}

/** Year-filter / KPI scoping — computed at the HTTP boundary (it reads
 *  `searchParams.year`) and passed in so the view stays request-agnostic. */
export interface StudentDashboardViewOpts {
  /** `Date.now()`-anchored render time. Drives "today" windows + `renderedAtMs`. */
  now: Date;
  /** Whether the selected year equals the current year (unscoped counts). */
  isCurrentYear: boolean;
  /** ISO Jan 1 of the selected year (lower bound for scoped counts). */
  yearStart: string;
  /** ISO Dec 31 23:59:59.999 of the selected year (upper bound for scoped counts). */
  yearEnd: string;
  /** ISO month-start for the "this month" KPI (= yearStart when not current year). */
  monthStart: string;
  /** ISO upper bound for the month KPI, or undefined for "current month onwards". */
  monthEnd: string | undefined;
}

/**
 * The above-fold bundle `StudentDashboardContent` renders.
 *
 * Slow widget data (analytics chart, live sessions, hwCounts, murajaah,
 * watching rows) is intentionally ABSENT — those are fetched by the
 * independently-streamed slots (`StudentAnalyticsSection`,
 * `StudentMurajaahSection`) and never block the initial render.
 */
export interface StudentDashboardData {
  fullName: string | null;
  nextBooking: { id: string; teacher_id: string; scheduled_at: string; duration_min: number; session_type: string } | null;
  sessionId: string | null;
  totalSessions: number;
  monthSessions: number;
  pendingBookings: number;
  nameMap: Record<string, string>;
  activePackages: { id: string; sessions_total: number; sessions_used: number; status: string; expires_at: string | null }[];
  nextQuiz: { id: string; title: string; due_at: string | null } | null;
  lastProgress: { surah_to: number | null; ayah_to: number | null; surah_from: number | null; ayah_from: number | null; level: string; recitation_standard: string | null; created_at: string } | null;
  resumeLesson: { lessonId: string; title: string; href: string; progressPct: number } | null;
  streakInfo: { streak: number; weeklyMinutes: number; weeklyDelta: number; loggedToday: boolean };
  homeworkPulse: { overdue: number; dueToday: number; dueThisWeek: number; nextItem: { id: string; description: string | null; dueDate: string | null; type: string } | null };
  todaySessions: { id: string; teacher_id: string; scheduled_at: string; duration_min: number; session_type: string; status: string }[];
  todayHomework: { id: string; description: string | null; due_date: string | null; homework_type: string; status: string }[];
  latestEvaluation: { next_goals: string | null; evaluation_type: string; created_at: string } | null;
  goal: GoalDashboardData | null;
  /** Earned achievement badges (spec 033). Empty array when none earned yet. */
  achievements: { type: string; metadata_json: Record<string, unknown>; unlocked_at: string }[];
  renderedAtMs: number;
}

export interface StudentDashboardViewResult {
  data: StudentDashboardData;
  /** True if ANY read on the page failed — drives the DataLoadBanner. */
  anyFailed: boolean;
  /** True for brand-new students with no activity — page redirects to teachers. */
  isNewStudent: boolean;
}

/** Slow analytics widget data, fetched independently by `StudentAnalyticsSection`. */
export interface StudentAnalyticsWidgetData {
  studyAnalytics: { daily: ChartDataPoint[]; weekly: ChartDataPoint[]; monthly: ChartDataPoint[] };
  liveSessions: { id: string; title: string; subtitle: string; initials: string; timeRemaining?: string; progressPercent?: number }[];
  hwCounts: Record<string, number>;
  watchingRows: Record<string, unknown>[];
  continueIsLessons: boolean;
  /** True when one or more homework HEAD-count queries failed — UI should show an inline warning instead of treating zeros as real. */
  anyFailed: boolean;
}

const ROUTE = "student-dashboard";

// Homework status counts via 6 parallel HEAD queries (one per enum value) —
// replaces an unbounded SELECT-all-rows that scaled with student history. Each
// count uses a covering index on (student_id, status).
const HW_STATUSES = [
  "assigned",
  "student_ready",
  "completed_excellent",
  "completed_good",
  "completed_needs_work",
  "completed_not_done",
] as const;

/**
 * Assemble the fast above-fold read bundle for the student dashboard.
 *
 * Slow queries (analytics, murajaah) have been moved to widget functions below.
 *
 * @param supabase  Injected server client (the test seam — page passes the real one).
 * @param studentId The authenticated student's user id.
 * @param opts      Year-filter / KPI scoping + render clock (see {@link StudentDashboardViewOpts}).
 */
export async function studentDashboardView(
  supabase: ServerClient,
  studentId: string,
  opts: StudentDashboardViewOpts,
): Promise<StudentDashboardViewResult> {
  const { now, isCurrentYear, yearStart, yearEnd, monthStart, monthEnd } = opts;

  // ── Batch 1: profile + next booking + slim KPI counts ──────────────────
  const totalQ = supabase.from("bookings").select("id", { count: "exact", head: true })
    .eq("student_id", studentId).eq("status", "completed");
  const totalQScoped = isCurrentYear
    ? totalQ
    : totalQ.gte("created_at", yearStart).lte("created_at", yearEnd);

  let monthQ = supabase.from("bookings").select("id", { count: "exact", head: true })
    .eq("student_id", studentId).eq("status", "completed").gte("created_at", monthStart);
  if (monthEnd) monthQ = monthQ.lte("created_at", monthEnd);

  const [profileRes, nextBookingRes, totalRes, monthRes, pendingRes, activeSubRes] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", studentId).single<{ full_name: string | null }>(),
    supabase.from("bookings")
      .select("id, teacher_id, scheduled_at, duration_min, session_type, status")
      .eq("student_id", studentId).eq("status", "confirmed")
      .gt("scheduled_at", opts.now.toISOString())
      .order("scheduled_at", { ascending: true }).limit(1)
      .returns<{ id: string; teacher_id: string; scheduled_at: string; duration_min: number; session_type: SessionType }[]>(),
    totalQScoped,
    monthQ,
    supabase.from("bookings").select("id", { count: "exact", head: true }).eq("student_id", studentId).eq("status", "pending"),
    supabase.from("subscriptions").select("id", { count: "exact", head: true }).eq("student_id", studentId).eq("status", "active").limit(1),
  ]);

  const profileLoad = loadOrFail(profileRes, { full_name: null }, { route: ROUTE, widget: "profile" });
  const nextBookingLoad = loadOrFail(nextBookingRes, [], { route: ROUTE, widget: "next-booking" });
  const totalLoad = countOrFail(totalRes, { route: ROUTE, widget: "total-sessions" });
  const monthLoad = countOrFail(monthRes, { route: ROUTE, widget: "month-sessions" });
  const pendingLoad = countOrFail(pendingRes, { route: ROUTE, widget: "pending-bookings" });
  let anyFailed = profileLoad.failed || nextBookingLoad.failed || totalLoad.failed || monthLoad.failed || pendingLoad.failed;

  const fullName = profileLoad.data?.full_name ?? null;
  const nextBooking = nextBookingLoad.data[0] ?? null;
  const totalSessions = totalLoad.count;
  const monthSessions = monthLoad.count;
  const pendingBookings = pendingLoad.count;
  const hasActiveSub = (activeSubRes.count ?? 0) > 0;

  const isNewStudent = !anyFailed && totalSessions === 0 && pendingBookings === 0 && !nextBooking && !hasActiveSub;
  if (isNewStudent) {
    return {
      data: emptyData(fullName, now),
      anyFailed,
      isNewStudent: true,
    };
  }

  // ── Batch 2: next-booking-dependent fan-out (teacher name + sessionId) ──
  const nameMap: Record<string, string> = {};
  let sessionId: string | null = null;
  if (nextBooking) {
    const [teacherProfile, session] = await Promise.all([
      supabase.from("profiles")
        .select("full_name").eq("id", nextBooking.teacher_id)
        .single<{ full_name: string | null }>(),
      supabase.from("sessions").select("id").eq("booking_id", nextBooking.id).maybeSingle<{ id: string }>(),
    ]);
    if (teacherProfile.data?.full_name) nameMap[nextBooking.teacher_id] = teacherProfile.data.full_name;
    sessionId = session.data?.id ?? null;
  }

  // ── Batch 3: fast widget data ───────────────────────────────────────────
  // Slow queries (analytics chart, live sessions, hwCounts, murajaah,
  // recentRecordings) have been moved to the streaming widget functions below.
  // continueWatching stays here so resumeLesson (NextActionBanner priority 6)
  // is available above-fold without waiting for the analytics slot.
  const [
    packagesRes, continueWatching, nextQuiz, lastProgressRes, streakInfo, homeworkPulse,
    latestEvalRes, goalLoad, achievementsRes,
  ] = await Promise.all([
    supabase.from("student_packages")
      .select("id, sessions_total, sessions_used, status, expires_at")
      .eq("student_id", studentId).eq("status", "active")
      .returns<{ id: string; sessions_total: number; sessions_used: number; status: string; expires_at: string | null }[]>(),
    getStudentContinueWatching(supabase, studentId),
    getStudentNextQuiz(supabase, studentId),
    supabase.from("student_progress")
      .select("surah_to, ayah_to, surah_from, ayah_from, level, recitation_standard, created_at")
      .eq("student_id", studentId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ surah_to: number | null; ayah_to: number | null; surah_from: number | null; ayah_from: number | null; level: string; recitation_standard: string | null; created_at: string }>(),
    getStudentStreak(supabase, studentId),
    getStudentHomeworkPulse(supabase, studentId),
    supabase.from("session_evaluations")
      .select("next_goals, evaluation_type, created_at")
      .eq("student_id", studentId)
      .not("next_goals", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ next_goals: string | null; evaluation_type: string; created_at: string }>(),
    helperOrFail(
      () => getGoalDashboardData(supabase, studentId, now),
      null,
      { route: ROUTE, widget: "goal" },
    ),
    (supabase as unknown as { from(t: string): {
      select(cols: string): { eq(col: string, val: string): {
        returns<T>(): Promise<{ data: T | null; error: unknown }>;
      } };
    } }).from("achievements").select("type, metadata_json, unlocked_at").eq("student_id", studentId)
      .returns<{ type: string; metadata_json: Record<string, unknown>; unlocked_at: string }[]>(),
  ]);

  const packagesLoad = loadOrFail(packagesRes, [], { route: ROUTE, widget: "active-packages" });
  const lastProgressLoad = loadOrFail(lastProgressRes, null, { route: ROUTE, widget: "last-progress" });
  const latestEvalLoad = loadOrFail(latestEvalRes, null, { route: ROUTE, widget: "latest-evaluation" });

  anyFailed = anyFailed || packagesLoad.failed || lastProgressLoad.failed || latestEvalLoad.failed || goalLoad.failed;

  // Spec 033: award streak badges (idempotent, never blocks render).
  if (streakInfo.streak >= 30) {
    after(() =>
      awardAchievement(studentId, "streak_30", { streak: streakInfo.streak }).catch((err) =>
        logError("streak_30 award failed", err, { tag: "achievements" }),
      ),
    );
  }
  if (streakInfo.streak >= 7) {
    after(() =>
      awardAchievement(studentId, "streak_7", { streak: streakInfo.streak }).catch((err) =>
        logError("streak_7 award failed", err, { tag: "achievements" }),
      ),
    );
  }

  const { data: achievementsData, error: achievementsErr } = achievementsRes as {
    data: { type: string; metadata_json: Record<string, unknown>; unlocked_at: string }[] | null;
    error: unknown;
  };
  if (achievementsErr) {
    logError("achievements widget load failed", achievementsErr, {
      tag: "achievements",
      route: "student-dashboard",
    });
  }
  const achievements = achievementsData ?? [];

  const activePackages = packagesLoad.data;
  const lastProgress = lastProgressLoad.data;

  // resumeLesson: derived from continueWatching (kept in core so NextActionBanner
  // priority 6 is available above-fold). The analytics slot re-fetches
  // continueWatching independently for the DataTable — the double-fetch is
  // accepted in exchange for not blocking the above-fold banner.
  const resumeLessonRow = continueWatching.find(r => r._lessonId && typeof r.progress === "number") as
    | { _lessonId: string; _href: string; subject: string; progress: number }
    | undefined;
  const resumeLesson = resumeLessonRow
    ? {
        lessonId: resumeLessonRow._lessonId,
        title: resumeLessonRow.subject,
        href: resumeLessonRow._href,
        progressPct: Math.round(resumeLessonRow.progress),
      }
    : null;

  // ── Batch 4: today's plan ───────────────────────────────────────────────
  // Kept in core (fast pair of queries) so TodaysPlan renders above-fold.
  const todayStart = new Date(now); todayStart.setUTCHours(0, 0, 0, 0); todayStart.setUTCDate(todayStart.getUTCDate() - 1);
  const todayEnd = new Date(now); todayEnd.setUTCHours(23, 59, 59, 999); todayEnd.setUTCDate(todayEnd.getUTCDate() + 1);

  const [todaySessionsRes, todayHomeworkRes] = await Promise.all([
    supabase.from("bookings")
      .select("id, teacher_id, scheduled_at, duration_min, session_type, status")
      .eq("student_id", studentId).eq("status", "confirmed")
      .gte("scheduled_at", todayStart.toISOString()).lte("scheduled_at", todayEnd.toISOString())
      .order("scheduled_at", { ascending: true })
      .returns<{ id: string; teacher_id: string; scheduled_at: string; duration_min: number; session_type: string; status: string }[]>(),
    supabase.from("homework_assignments")
      .select("id, description, due_date, homework_type, status")
      .eq("student_id", studentId)
      .in("status", ["assigned", "completed_needs_work"])
      .gte("due_date", todayStart.toISOString()).lte("due_date", todayEnd.toISOString())
      .order("due_date", { ascending: true })
      .returns<{ id: string; description: string | null; due_date: string | null; homework_type: string; status: string }[]>(),
  ]);

  const todaySessionsLoad = loadOrFail(todaySessionsRes, [], { route: ROUTE, widget: "today-sessions" });
  const todayHomeworkLoad = loadOrFail(todayHomeworkRes, [], { route: ROUTE, widget: "today-homework" });
  anyFailed = anyFailed || todaySessionsLoad.failed || todayHomeworkLoad.failed;
  const todaySessions = todaySessionsLoad.data;
  const todayHomework = todayHomeworkLoad.data;

  // Resolve teacher names for today's sessions (only if not already in nameMap).
  const todayTeacherIds = todaySessions
    .map(s => s.teacher_id)
    .filter(id => !nameMap[id]);
  if (todayTeacherIds.length > 0) {
    const { data: teachers } = await supabase
      .from("profiles").select("id, full_name")
      .in("id", todayTeacherIds)
      .returns<{ id: string; full_name: string | null }[]>();
    for (const t of teachers ?? []) {
      if (t.full_name) nameMap[t.id] = t.full_name;
    }
  }

  return {
    data: {
      fullName,
      nextBooking,
      sessionId,
      totalSessions,
      monthSessions,
      pendingBookings,
      nameMap,
      activePackages: activePackages ?? [],
      nextQuiz,
      lastProgress,
      resumeLesson,
      streakInfo,
      homeworkPulse,
      todaySessions,
      todayHomework,
      latestEvaluation: latestEvalLoad.data,
      goal: goalLoad.data,
      achievements,
      renderedAtMs: now.getTime(),
    },
    anyFailed,
    isNewStudent: false,
  };
}

/**
 * Minimal bundle for the new-student short-circuit.
 */
function emptyData(fullName: string | null, now: Date): StudentDashboardData {
  return {
    fullName,
    nextBooking: null,
    sessionId: null,
    totalSessions: 0,
    monthSessions: 0,
    pendingBookings: 0,
    nameMap: {},
    activePackages: [],
    nextQuiz: null,
    lastProgress: null,
    resumeLesson: null,
    streakInfo: { streak: 0, weeklyMinutes: 0, weeklyDelta: 0, loggedToday: false },
    homeworkPulse: { overdue: 0, dueToday: 0, dueThisWeek: 0, nextItem: null },
    todaySessions: [],
    todayHomework: [],
    latestEvaluation: null,
    goal: null,
    achievements: [],
    renderedAtMs: now.getTime(),
  };
}

// ── Streaming widget functions ──────────────────────────────────────────────
// These are called by async Server Components in the student dashboard page,
// each wrapped in <Suspense> so they stream independently without blocking
// the above-fold render. The page passes them as slot props to the client
// component shell.

/**
 * Murajaah review widget data — fetched independently so the murajaah card
 * streams in without delaying the KPI grid or Today's Plan.
 */
export async function studentMurajaahWidgetData(
  supabase: ServerClient,
  studentId: string,
): Promise<MurajaahDueItem[]> {
  return getTodaysMurajaahBatch(supabase, studentId);
}

/**
 * Analytics widget data — the slowest batch (chart aggregation + live sessions +
 * 6 hwCount HEAD queries + continue-watching / recent-recordings).
 *
 * continueWatching is re-fetched here (also fetched in core for resumeLesson).
 * The double-fetch is intentional: it lets the analytics slot be fully
 * self-contained and stream without coordination with the core view.
 */
export async function studentAnalyticsWidgetData(
  supabase: ServerClient,
  studentId: string,
): Promise<StudentAnalyticsWidgetData> {
  const hwCountsP = Promise.all(
    HW_STATUSES.map(s =>
      supabase.from("homework_assignments")
        .select("id", { count: "exact", head: true })
        .eq("student_id", studentId).eq("status", s)
    )
  );

  const [studyAnalytics, liveSessions, continueWatching, recentRecordings, hwCountsRaw] = await Promise.all([
    getStudentStudyAnalytics(supabase, studentId),
    getStudentLiveSessions(supabase, studentId),
    getStudentContinueWatching(supabase, studentId),
    getStudentRecentRecordings(supabase, studentId),
    hwCountsP,
  ]);

  const hwCounts: Record<string, number> = {};
  let anyFailed = false;
  HW_STATUSES.forEach((s, i) => {
    const r = countOrFail(hwCountsRaw[i], { route: ROUTE, widget: `homework-${s}` });
    hwCounts[s] = r.count;
    anyFailed ||= r.failed;
  });

  const continueIsLessons = continueWatching.length > 0;
  const watchingRows = continueIsLessons ? continueWatching : recentRecordings;

  return { studyAnalytics, liveSessions, hwCounts, watchingRows, continueIsLessons, anyFailed };
}
