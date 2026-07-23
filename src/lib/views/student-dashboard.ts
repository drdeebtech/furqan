import { after } from "next/server";
import { loadOrFail, countOrFail, helperOrFail } from "@/lib/supabase/load-or-fail";
import { unreadMessagesFilter } from "@/lib/views/_shared/unread-messages";
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
} from "@/lib/views/student-dashboard-queries";

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
  latestEvaluation: { overall_score: number | null; strengths: string | null; next_goals: string | null; evaluation_type: string; created_at: string } | null;
  /** S1 — active-subscription summary; null unless the student has one active. */
  subscription: { planName: string | null; status: string; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean } | null;
  /** S2 — unread messages across the student's conversations. */
  unreadMessages: number;
  goal: GoalDashboardData | null;
  /** Earned achievement badges (spec 033). Empty array when none earned yet. */
  achievements: { type: string; metadata_json: Record<string, unknown>; unlocked_at: string }[];
  /**
   * Spec 038 — prepaid-hour wallet summary. Null when the student has NO
   * active prepaid lots (subscription-only students never see the widget).
   * Reads are RLS `.from()` selects only (no RPC — the local RPC seam is
   * broken). sessions_remaining is GENERATED in DB → computed in TS here as
   * sessions_total - sessions_used so the column doesn't need to be in the
   * generated types yet.
   */
  prepaidWallet: {
    balanceHours: number;
    nearestExpiry: string | null;
    lots: {
      id: string;
      sessionsTotal: number;
      sessionsUsed: number;
      remaining: number;
      expiresAt: string | null;
      ratePaidUsd: number | null;
      purchasedAt: string;
    }[];
    history: { eventType: string; hoursDelta: number; createdAt: string }[];
  } | null;
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

  const [profileRes, nextBookingRes, totalRes, monthRes, pendingRes, activeSubRes, prepaidCountRes, convosRes] = await Promise.all([
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
    // Spec 038 — a student whose ONLY activity is a prepaid-hours purchase must
    // NOT be treated as "new": isNewStudent below short-circuits to emptyData
    // (prepaidWallet:null) BEFORE the wallet read in Batch 3, which would hide
    // the wallet from exactly the users who own hours. Cheap head-count feeds
    // the guard. Inline cast: product_type isn't in the generated types yet.
    (supabase as unknown as {
      from(t: string): {
        select(c: string, o: { count: "exact"; head: true }): {
          eq(c: string, v: string): {
            eq(c: string, v: string): {
              eq(c: string, v: string): Promise<{ count: number | null; error: unknown }>;
            };
          };
        };
      };
    })
      .from("student_packages")
      .select("id", { count: "exact", head: true })
      .eq("student_id", studentId)
      .eq("product_type", "prepaid_hours")
      .eq("status", "active"),
    // S2 — conversation ids for the unread-messages count (resolved in Batch 3).
    supabase.from("conversations").select("id").eq("student_id", studentId).returns<{ id: string }[]>(),
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
  // Spec 038 — owning prepaid hours is real activity; such a student sees the
  // full dashboard (incl. the wallet widget), never the "new student" state.
  const hasPrepaidHours = (prepaidCountRes.count ?? 0) > 0;
  // S2 — the student's conversation ids feed the unread-messages count in
  // Batch 3. Routed through loadOrFail so a failed read is logged and flips
  // anyFailed (no silent `?? []` default — silent-fail policy).
  const convosLoad = loadOrFail(convosRes, [] as { id: string }[], { route: ROUTE, widget: "conversations" });
  anyFailed = anyFailed || convosLoad.failed;
  const convIds = convosLoad.data.map((c) => c.id);

  const isNewStudent = !anyFailed && totalSessions === 0 && pendingBookings === 0 && !nextBooking && !hasActiveSub && !hasPrepaidHours && convIds.length === 0;
  if (isNewStudent) {
    return {
      data: emptyData(fullName, now),
      anyFailed,
      isNewStudent: true,
    };
  }

  // ── Batches 2+3+4 merged: all reads depending only on Batch-1 results ────
  // Batch 2 (next-booking teacher name + sessionId) needs only `nextBooking`
  // from Batch 1; Batch 3 (fast widget data) and Batch 4 (today's plan) need
  // only studentId/now. They're mutually independent, so a single Promise.all
  // fans them all out instead of three sequential awaits. The nextBooking-
  // dependent reads become conditional promises that no-op when there is no
  // next booking — preserving the original `if (nextBooking)` short-circuit
  // (no query fires, nameMap/sessionId stay empty/null).
  const nameMap: Record<string, string> = {};
  let sessionId: string | null = null;

  // Slow queries (analytics chart, live sessions, hwCounts, murajaah,
  // recentRecordings) have been moved to the streaming widget functions below.
  // continueWatching stays here so resumeLesson (NextActionBanner priority 6)
  // is available above-fold without waiting for the analytics slot.
  //
  // Spec 038 — the existing `student_packages` select now also reads
  // `product_type` (denormalized in Phase 1). The new column is not yet in the
  // generated types, so the localized-cast pattern (same shape used for
  // `achievements` below) loosens column-name checking without touching
  // database.ts. The new prepaid lots + ledger reads share widget tag
  // "prepaid-wallet" and rely on RLS for ownership (prepaid_hours_events has
  // no student_id column — see migration 20260715000000 — and the table's RLS
  // policy already restricts SELECT to rows whose package_id belongs to
  // auth.uid(); no `.in('package_id', lotIds)` filter is needed and that
  // avoids a chicken-and-egg with the lots query in the same batch).
  type PackagesRow = { id: string; sessions_total: number; sessions_used: number; status: string; expires_at: string | null };
  type PrepaidLotRow = {
    id: string; sessions_total: number; sessions_used: number;
    status: string; expires_at: string | null;
    rate_paid_usd: number | null; purchased_at: string;
  };
  type PrepaidEventRow = { event_type: string; hours_delta: number; created_at: string };

  const looseFrom = supabase as unknown as {
    from(table: string): {
      select(columns: string): {
        eq(col: string, val: string | number | boolean): {
          eq(col: string, val: string | number | boolean): {
            eq(col: string, val: string | number | boolean): {
              returns<T>(): Promise<{ data: T | null; error: { message: string; code?: string } | null }>;
            };
            returns<T>(): Promise<{ data: T | null; error: { message: string; code?: string } | null }>;
          };
          returns<T>(): Promise<{ data: T | null; error: { message: string; code?: string } | null }>;
        };
        order(col: string, opts: { ascending: boolean }): {
          limit(n: number): {
            returns<T>(): Promise<{ data: T | null; error: { message: string; code?: string } | null }>;
          };
        };
        returns<T>(): Promise<{ data: T | null; error: { message: string; code?: string } | null }>;
      };
    };
  };

  // Batch 4's today window — pure date math, hoisted out of the old Batch 4 so
  // its queries can join the merged Promise.all.
  const todayStart = new Date(now); todayStart.setUTCHours(0, 0, 0, 0); todayStart.setUTCDate(todayStart.getUTCDate() - 1);
  const todayEnd = new Date(now); todayEnd.setUTCHours(23, 59, 59, 999); todayEnd.setUTCDate(todayEnd.getUTCDate() + 1);

  const [
    teacherProfileRes, sessionRes,
    packagesRes, continueWatching, nextQuiz, lastProgressRes, streakInfo, homeworkPulse,
    latestEvalRes, goalLoad, achievementsRes, prepaidLotsRes, prepaidEventsRes,
    todaySessionsRes, todayHomeworkRes, subscriptionRes, unreadRes,
  ] = await Promise.all([
    // Batch 2: next-booking teacher name + sessionId (no-op without nextBooking).
    nextBooking
      ? supabase.from("profiles")
        .select("full_name").eq("id", nextBooking.teacher_id)
        .single<{ full_name: string | null }>()
      : Promise.resolve({ data: null as { full_name: string | null } | null, error: null }),
    nextBooking
      ? supabase.from("sessions").select("id").eq("booking_id", nextBooking.id).maybeSingle<{ id: string }>()
      : Promise.resolve({ data: null as { id: string } | null, error: null }),
    // Batch 3: fast widget data.
    looseFrom.from("student_packages")
      .select("id, sessions_total, sessions_used, status, expires_at, product_type")
      .eq("student_id", studentId).eq("status", "active")
      .returns<PackagesRow[]>(),
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
      .select("overall_score, strengths, next_goals, evaluation_type, created_at")
      .eq("student_id", studentId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ overall_score: number | null; strengths: string | null; next_goals: string | null; evaluation_type: string; created_at: string }>(),
    helperOrFail(
      () => getGoalDashboardData(supabase, studentId, now),
      null,
      { route: ROUTE, widget: "goal" },
    ),
    looseFrom.from("achievements").select("type, metadata_json, unlocked_at").eq("student_id", studentId)
      .returns<{ type: string; metadata_json: Record<string, unknown>; unlocked_at: string }[]>(),
    // Spec 038 — active prepaid-hour lots (immutable, one row per purchase).
    looseFrom.from("student_packages")
      .select("id, sessions_total, sessions_used, status, expires_at, rate_paid_usd, purchased_at")
      .eq("student_id", studentId)
      .eq("product_type", "prepaid_hours")
      .eq("status", "active")
      .returns<PrepaidLotRow[]>(),
    // Spec 038 — append-only ledger. RLS restricts to the student's own lots
    // via the package_id → student_packages.student_id = auth.uid() join, so a
    // bare ordered SELECT returns only their events (no student_id column).
    looseFrom.from("prepaid_hours_events")
      .select("event_type, hours_delta, created_at")
      .order("created_at", { ascending: false })
      .limit(20)
      .returns<PrepaidEventRow[]>(),
    // Batch 4: today's plan (kept in core so TodaysPlan renders above-fold).
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
    // S1 — active subscription (plan_id resolved to a name in a follow-up read).
    supabase.from("subscriptions")
      .select("plan_id, status, current_period_end, cancel_at_period_end")
      .eq("student_id", studentId).eq("status", "active")
      .order("current_period_end", { ascending: false })
      .limit(1)
      .maybeSingle<{ plan_id: string; status: string; current_period_end: string | null; cancel_at_period_end: boolean }>(),
    // S2 — unread messages; skip the query when the student has no conversations.
    convIds.length > 0
      ? unreadMessagesFilter(supabase, convIds, studentId)
      : Promise.resolve({ count: 0, error: null }),
  ]);

  // Batch 2 post-process: only touch nameMap/sessionId when nextBooking exists.
  if (nextBooking) {
    if (teacherProfileRes.data?.full_name) nameMap[nextBooking.teacher_id] = teacherProfileRes.data.full_name;
    sessionId = sessionRes.data?.id ?? null;
  }

  const packagesLoad = loadOrFail(packagesRes, [], { route: ROUTE, widget: "active-packages" });
  const lastProgressLoad = loadOrFail(lastProgressRes, null, { route: ROUTE, widget: "last-progress" });
  const latestEvalLoad = loadOrFail(latestEvalRes, null, { route: ROUTE, widget: "latest-evaluation" });
  const prepaidLotsLoad = loadOrFail(prepaidLotsRes, [], { route: ROUTE, widget: "prepaid-wallet" });
  const prepaidEventsLoad = loadOrFail(prepaidEventsRes, [], { route: ROUTE, widget: "prepaid-wallet" });

  anyFailed = anyFailed
    || packagesLoad.failed
    || lastProgressLoad.failed
    || latestEvalLoad.failed
    || goalLoad.failed
    || prepaidLotsLoad.failed
    || prepaidEventsLoad.failed;

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

  const todaySessionsLoad = loadOrFail(todaySessionsRes, [], { route: ROUTE, widget: "today-sessions" });
  const todayHomeworkLoad = loadOrFail(todayHomeworkRes, [], { route: ROUTE, widget: "today-homework" });
  anyFailed = anyFailed || todaySessionsLoad.failed || todayHomeworkLoad.failed;
  const todaySessions = todaySessionsLoad.data;
  const todayHomework = todayHomeworkLoad.data;

  // S1 — active-subscription summary. The plan name is resolved with a small
  // follow-up read (mirrors the today-teacher-name resolution below), avoiding
  // an embedded PostgREST join. Null unless the student has an active
  // subscription, so package/prepaid-only students never see the card.
  const subscriptionLoad = loadOrFail(subscriptionRes, null, { route: ROUTE, widget: "subscription" });
  anyFailed = anyFailed || subscriptionLoad.failed;
  let subscription: {
    planName: string | null;
    status: string;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  } | null = null;
  if (subscriptionLoad.data) {
    const sub = subscriptionLoad.data;
    const planRes = await supabase
      .from("subscription_plans").select("name").eq("id", sub.plan_id)
      .maybeSingle<{ name: string }>();
    const planLoad = loadOrFail(planRes, null, { route: ROUTE, widget: "subscription-plan" });
    anyFailed = anyFailed || planLoad.failed;
    subscription = {
      planName: planLoad.data ? planLoad.data.name : null,
      status: sub.status,
      currentPeriodEnd: sub.current_period_end,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    };
  }

  // S2 — unread messages in the student's conversations (mirrors the teacher
  // dashboard read). Non-critical: a failed read just yields no badge.
  const unreadLoad = countOrFail(unreadRes, { route: ROUTE, widget: "unread-messages" });
  anyFailed = anyFailed || unreadLoad.failed;
  const unreadMessages = unreadLoad.count;

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

  // Spec 038 — derive the prepaid-hour wallet summary from the active lots +
  // ledger. Null when the student has NO active prepaid lots, so the widget
  // stays hidden for subscription-only students. sessions_remaining is a
  // GENERATED column in DB; computed in TS here as (sessions_total −
  // sessions_used) so the column need not be in generated types yet.
  const prepaidLots = prepaidLotsLoad.data ?? [];
  const prepaidEvents = prepaidEventsLoad.data ?? [];
  const prepaidWallet = prepaidLots.length > 0
    ? (() => {
        const lotsWithRemaining = prepaidLots.map((lot) => {
          const remaining = Math.max(0, lot.sessions_total - lot.sessions_used);
          return { lot, remaining };
        });
        const balanceHours = lotsWithRemaining.reduce((sum, l) => sum + l.remaining, 0);
        // Earliest expiry among lots that still have hours left — expired-but-
        // unbilled lots with remaining=0 should not pin the "nearest expiry".
        const futureExpiries = lotsWithRemaining
          .filter((l) => l.remaining > 0 && l.lot.expires_at)
          .map((l) => l.lot.expires_at as string)
          .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
        return {
          balanceHours,
          nearestExpiry: futureExpiries[0] ?? null,
          lots: lotsWithRemaining
            .map((l) => ({
              id: l.lot.id,
              sessionsTotal: l.lot.sessions_total,
              sessionsUsed: l.lot.sessions_used,
              remaining: l.remaining,
              expiresAt: l.lot.expires_at,
              ratePaidUsd: l.lot.rate_paid_usd,
              purchasedAt: l.lot.purchased_at,
            }))
            // Show the most recently purchased lots first.
            .sort((a, b) => new Date(b.purchasedAt).getTime() - new Date(a.purchasedAt).getTime()),
          history: prepaidEvents.map((ev) => ({
            eventType: ev.event_type,
            hoursDelta: ev.hours_delta,
            createdAt: ev.created_at,
          })),
        };
      })()
    : null;

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
      prepaidWallet,
      subscription,
      unreadMessages,
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
    prepaidWallet: null,
    subscription: null,
    unreadMessages: 0,
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
