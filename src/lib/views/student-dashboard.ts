import { createClient } from "@/lib/supabase/server";
import { loadOrFail, countOrFail } from "@/lib/supabase/load-or-fail";
import type { SessionType } from "@/types/database";
import {
  getStudentStudyAnalytics,
  getStudentLiveSessions,
  getStudentRecentRecordings,
  getStudentContinueWatching,
  getStudentNextQuiz,
  getStudentStreak,
  getStudentHomeworkPulse,
  getStudentMurajaahPlan,
  type MurajaahWindow,
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
 * Tracer note: this is the first slice of a spec-kit'd multi-PR sweep that
 * pulls teacher + admin dashboard reads behind sibling `src/lib/views/*`
 * modules and shrinks the 1838-line `dashboard-queries.ts` god-module. The 8
 * `getStudent*` helpers still open their own `createClient()` internally; a
 * follow-up threads the injected client through them so the whole screen reads
 * on one client. They are kept as-is here to keep the tracer behavior-identical.
 */

type ServerClient = Awaited<ReturnType<typeof createClient>>;

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

/** The exact bundle `StudentDashboardContent` renders. */
export interface StudentDashboardData {
  fullName: string | null;
  nextBooking: { id: string; teacher_id: string; scheduled_at: string; duration_min: number; session_type: string } | null;
  sessionId: string | null;
  totalSessions: number;
  monthSessions: number;
  pendingBookings: number;
  nameMap: Record<string, string>;
  studyAnalytics: { daily: ChartDataPoint[]; weekly: ChartDataPoint[]; monthly: ChartDataPoint[] };
  liveSessions: { id: string; title: string; subtitle: string; initials: string; timeRemaining?: string; progressPercent?: number }[];
  watchingRows: Record<string, unknown>[];
  continueIsLessons: boolean;
  hwCounts: Record<string, number>;
  activePackages: { id: string; sessions_total: number; sessions_used: number; status: string; expires_at: string | null }[];
  nextQuiz: { id: string; title: string; due_at: string | null } | null;
  lastProgress: { surah_to: number | null; ayah_to: number | null; surah_from: number | null; ayah_from: number | null; level: string; recitation_standard: string | null; created_at: string } | null;
  resumeLesson: { lessonId: string; title: string; href: string; progressPct: number } | null;
  streakInfo: { streak: number; weeklyMinutes: number; weeklyDelta: number; loggedToday: boolean };
  homeworkPulse: { overdue: number; dueToday: number; dueThisWeek: number; nextItem: { id: string; description: string | null; dueDate: string | null; type: string } | null };
  todaySessions: { id: string; teacher_id: string; scheduled_at: string; duration_min: number; session_type: string; status: string }[];
  todayHomework: { id: string; description: string | null; due_date: string | null; homework_type: string; status: string }[];
  latestEvaluation: { next_goals: string | null; evaluation_type: string; created_at: string } | null;
  murajaahPlan: {
    yesterday: MurajaahWindow | null;
    lastWeek: MurajaahWindow | null;
    lastMonth: MurajaahWindow | null;
    reviewedToday: boolean;
  };
  renderedAtMs: number;
}

export interface StudentDashboardViewResult {
  data: StudentDashboardData;
  /** True if ANY read on the page failed — drives the DataLoadBanner. */
  anyFailed: boolean;
  /** True for brand-new students with no activity — page redirects to teachers. */
  isNewStudent: boolean;
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
 * Assemble the full read bundle for the student dashboard.
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
  // Slim KPI queries — recent-sessions + evaluations tables moved off the
  // dashboard (they live at /student/sessions and /student/progress).
  const totalQ = supabase.from("bookings").select("id", { count: "exact", head: true })
    .eq("student_id", studentId).eq("status", "completed");
  const totalQScoped = isCurrentYear
    ? totalQ
    : totalQ.gte("created_at", yearStart).lte("created_at", yearEnd);

  let monthQ = supabase.from("bookings").select("id", { count: "exact", head: true })
    .eq("student_id", studentId).eq("status", "completed").gte("created_at", monthStart);
  if (monthEnd) monthQ = monthQ.lte("created_at", monthEnd);

  const [profileRes, nextBookingRes, totalRes, monthRes, pendingRes] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", studentId).single<{ full_name: string | null }>(),
    supabase.from("bookings")
      .select("id, teacher_id, scheduled_at, duration_min, session_type, status")
      .eq("student_id", studentId).eq("status", "confirmed")
      .gt("scheduled_at", new Date().toISOString())
      .order("scheduled_at", { ascending: true }).limit(1)
      .returns<{ id: string; teacher_id: string; scheduled_at: string; duration_min: number; session_type: SessionType }[]>(),
    totalQScoped,
    monthQ,
    supabase.from("bookings").select("id", { count: "exact", head: true }).eq("student_id", studentId).eq("status", "pending"),
  ]);

  // loadOrFail: pipe failed reads through Sentry with the dashboard route
  // tagged, so we know WHICH widget tripped (vs Sprint 1.1 which only sees
  // the URL). anyFailed accumulates across the whole page so the banner
  // surfaces even when only one of the loads broke.
  const profileLoad = loadOrFail(profileRes, { full_name: null }, { route: ROUTE, widget: "profile" });
  const nextBookingLoad = loadOrFail(nextBookingRes, [], { route: ROUTE, widget: "next-booking" });
  const totalLoad = loadOrFail(totalRes, null, { route: ROUTE, widget: "total-sessions" });
  const monthLoad = loadOrFail(monthRes, null, { route: ROUTE, widget: "month-sessions" });
  const pendingLoad = loadOrFail(pendingRes, null, { route: ROUTE, widget: "pending-bookings" });
  let anyFailed = profileLoad.failed || nextBookingLoad.failed || totalLoad.failed || monthLoad.failed || pendingLoad.failed;

  const fullName = profileLoad.data?.full_name ?? null;
  const nextBooking = nextBookingLoad.data[0] ?? null;
  const totalSessions = totalRes.count ?? 0;
  const monthSessions = monthRes.count ?? 0;
  const pendingBookings = pendingRes.count ?? 0;

  // New students with no activity → page guides them to the teachers screen.
  const isNewStudent = !anyFailed && totalSessions === 0 && pendingBookings === 0 && !nextBooking;
  if (isNewStudent) {
    return {
      data: emptyData(fullName, now),
      anyFailed,
      isNewStudent: true,
    };
  }

  // ── Batch 2: next-booking-dependent fan-out (teacher name + sessionId) ──
  // Only the next-session teacher name is shown above the fold; trim the
  // teacher-name fan-out that the old recent + evaluations tables required.
  // Both the teacher-name lookup and the sessions.id lookup depend on
  // nextBooking but on DIFFERENT fields — fan out as a parallel pair so
  // the post-batch-1 sequential cost shrinks from 2 RTs to 1 RT. The
  // .maybeSingle() on sessions is intentional: the sessions row only
  // exists once the teacher starts the call, so 0 rows is the normal
  // "no session yet" state (single() would throw PGRST116, Sentry E4-1A).
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

  // ── Batch 3: packages + follow-up counts + widget helpers + waypoints ──
  // Parallel: packages + follow-up + dashboard widgets + most-recent learning
  // waypoint (drives the surah breadcrumb above the KPI grid) + streak +
  // follow-up pulse (drives the smart NextActionBanner).
  const hwCountsP = Promise.all(
    HW_STATUSES.map(s =>
      supabase.from("homework_assignments")
        .select("id", { count: "exact", head: true })
        .eq("student_id", studentId).eq("status", s)
    )
  );

  const [
    packagesRes, hwCountsRaw, studyAnalytics, liveSessions, continueWatching,
    recentRecordings, nextQuiz, lastProgressRes, streakInfo, homeworkPulse,
    latestEvalRes, murajaahPlan,
  ] = await Promise.all([
    supabase.from("student_packages")
      .select("id, sessions_total, sessions_used, status, expires_at")
      .eq("student_id", studentId).eq("status", "active")
      .returns<{ id: string; sessions_total: number; sessions_used: number; status: string; expires_at: string | null }[]>(),
    hwCountsP,
    getStudentStudyAnalytics(studentId),
    getStudentLiveSessions(studentId),
    getStudentContinueWatching(studentId),
    getStudentRecentRecordings(studentId),
    getStudentNextQuiz(studentId),
    supabase.from("student_progress")
      .select("surah_to, ayah_to, surah_from, ayah_from, level, recitation_standard, created_at")
      .eq("student_id", studentId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ surah_to: number | null; ayah_to: number | null; surah_from: number | null; ayah_from: number | null; level: string; recitation_standard: string | null; created_at: string }>(),
    getStudentStreak(studentId),
    getStudentHomeworkPulse(studentId),
    // Latest evaluation's next_goals text — drives the "Your focus this
    // week" card. Only next_goals + meta are needed; the full
    // strengths/areas_for_improvement live on /student/progress to avoid duplication.
    supabase.from("session_evaluations")
      .select("next_goals, evaluation_type, created_at")
      .eq("student_id", studentId)
      .not("next_goals", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ next_goals: string | null; evaluation_type: string; created_at: string }>(),
    getStudentMurajaahPlan(studentId),
  ]);
  const packagesLoad = loadOrFail(packagesRes, [], { route: ROUTE, widget: "active-packages" });
  const lastProgressLoad = loadOrFail(lastProgressRes, null, { route: ROUTE, widget: "last-progress" });
  const latestEvalLoad = loadOrFail(latestEvalRes, null, { route: ROUTE, widget: "latest-evaluation" });

  // Per-status counts with their own Sentry widget tags — Sentry now reads
  // "student-dashboard.homework-completed_excellent failed" not just
  // "homework-counts failed", so a flaky enum branch surfaces directly.
  const hwCounts: Record<string, number> = {};
  let hwCountsFailed = false;
  HW_STATUSES.forEach((s, i) => {
    const r = countOrFail(hwCountsRaw[i], { route: ROUTE, widget: `homework-${s}` });
    hwCounts[s] = r.count;
    if (r.failed) hwCountsFailed = true;
  });

  anyFailed = anyFailed || packagesLoad.failed || hwCountsFailed || lastProgressLoad.failed || latestEvalLoad.failed;

  const activePackages = packagesLoad.data;
  // Continue Watching prefers in-progress course lessons; falls back to recent
  // session recordings so the table is never empty for active students. The
  // boolean lets the client component title the section honestly — calling
  // session recordings "Pick up where you left off" was the source of the
  // /student/courses confusion the audit flagged (P2-3).
  const continueIsLessons = continueWatching.length > 0;
  const watchingRows = continueIsLessons ? continueWatching : recentRecordings;
  const lastProgress = lastProgressLoad.data;
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

  // ── Batch 4: today's plan (sessions + follow-up due today) ─────────────
  // Today's plan items — sessions today + follow-up due today + quiz due today.
  // Built server-side so the widget never re-queries client-side.
  // Use a UTC ±1-day window so students in any timezone (up to UTC+14 / UTC-12)
  // always receive their local-today sessions. The client-side todaysPlanItems
  // useMemo already has the live `now` ticker and trims to true local-today.
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
      studyAnalytics,
      liveSessions,
      watchingRows,
      continueIsLessons,
      hwCounts,
      activePackages: activePackages ?? [],
      nextQuiz,
      lastProgress,
      resumeLesson,
      streakInfo,
      homeworkPulse,
      todaySessions,
      todayHomework,
      latestEvaluation: latestEvalLoad.data,
      murajaahPlan,
      renderedAtMs: now.getTime(),
    },
    anyFailed,
    isNewStudent: false,
  };
}

/**
 * Minimal bundle for the new-student short-circuit. The page redirects before
 * rendering, so this value is never displayed — it exists only to keep the
 * return type total without forcing the page to special-case a partial bundle.
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
    studyAnalytics: { daily: [], weekly: [], monthly: [] },
    liveSessions: [],
    watchingRows: [],
    continueIsLessons: false,
    hwCounts: {},
    activePackages: [],
    nextQuiz: null,
    lastProgress: null,
    resumeLesson: null,
    streakInfo: { streak: 0, weeklyMinutes: 0, weeklyDelta: 0, loggedToday: false },
    homeworkPulse: { overdue: 0, dueToday: 0, dueThisWeek: 0, nextItem: null },
    todaySessions: [],
    todayHomework: [],
    latestEvaluation: null,
    murajaahPlan: { yesterday: null, lastWeek: null, lastMonth: null, reviewedToday: false },
    renderedAtMs: now.getTime(),
  };
}
