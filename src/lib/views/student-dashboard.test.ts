/**
 * Unit tests for the two streaming widget functions extracted from the
 * student dashboard view (feat/547-student-dashboard-streaming).
 *
 * Pre-test verification (per common/testing.md):
 * - Both functions are pure async read bundles — no side effects.
 * - No OAuth/session flows, no HMAC.  We stub the supabase client.
 * - `getTodaysMurajaahBatch` et al. come from dashboard-queries — mocked below.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Module stubs required by server-only imports ──────────────────────────────
vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: vi.fn() }));

// ── Mock student-dashboard-queries helpers ───────────────────────────────────
vi.mock("@/lib/views/student-dashboard-queries", () => ({
  getTodaysMurajaahBatch: vi.fn(),
  getStudentStudyAnalytics: vi.fn(),
  getStudentLiveSessions: vi.fn(),
  getStudentContinueWatching: vi.fn(),
  getStudentRecentRecordings: vi.fn(),
  // Additional helpers used by studentDashboardView (not the widget functions)
  getStudentNextQuiz: vi.fn(),
  getStudentStreak: vi.fn(),
  getStudentHomeworkPulse: vi.fn(),
}));

// ── Mock load-or-fail so countOrFail is controllable ─────────────────────────
vi.mock("@/lib/supabase/load-or-fail", () => ({
  loadOrFail: vi.fn((res: { data: unknown }, fallback: unknown) => ({
    data: res.data ?? fallback,
    failed: res.data == null,
  })),
  countOrFail: vi.fn((res: { count: number | null }) => ({
    count: res.count ?? 0,
    failed: res.count == null,
  })),
  helperOrFail: vi.fn((data: unknown, fallback: unknown) => ({
    data: data ?? fallback,
    failed: data == null,
  })),
}));

// Other server-module stubs
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));
vi.mock("@/lib/domains/achievements/award", () => ({ awardAchievement: vi.fn() }));
vi.mock("@/lib/domains/goals/goals", () => ({ getGoalDashboardData: vi.fn() }));

import {
  studentMurajaahWidgetData,
  studentAnalyticsWidgetData,
  studentDashboardView,
  type StudentDashboardViewOpts,
} from "./student-dashboard";
import {
  getTodaysMurajaahBatch,
  getStudentStudyAnalytics,
  getStudentLiveSessions,
  getStudentContinueWatching,
  getStudentRecentRecordings,
  getStudentNextQuiz,
  getStudentStreak,
  getStudentHomeworkPulse,
} from "@/lib/views/student-dashboard-queries";
import { logError } from "@/lib/logger";
import { after } from "next/server";
import { awardAchievement } from "@/lib/domains/achievements/award";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a minimal Supabase-like chain that resolves hwCount HEAD queries.
 * Pass a single number to use it for all 6 queries, or an array of
 * (number | null) to set per-query values — null simulates a failed query.
 */
function makeSupabase(hwCountsArg: number | (number | null)[] = 0) {
  const counts = Array.isArray(hwCountsArg) ? hwCountsArg : Array(6).fill(hwCountsArg);
  let callIndex = 0;
  return {
    from: vi.fn(() => {
      const thisCount = counts[callIndex++] ?? null;
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        // `.then()` makes the chain thenable — resolves with a count result
        then: vi.fn((resolve: (v: { count: number | null }) => unknown) =>
          Promise.resolve({ count: thisCount }).then(resolve)
        ),
      };
    }),
  } as unknown as Parameters<typeof studentAnalyticsWidgetData>[0];
}

const STUDENT_ID = "student-abc-123";

const EMPTY_ANALYTICS = {
  daily: [],
  weekly: [],
  monthly: [],
};

// ── Helpers for studentDashboardView (requires richer supabase mock) ─────────

/**
 * Build a chainable Supabase-like query object that resolves to `result`.
 * All chaining methods (eq, gte, lte, etc.) return `this`.
 * Terminal methods (single, maybeSingle, returns) resolve to `result`.
 * The object is also thenable so count queries awaited directly in Promise.all work.
 */
// ponytail: typed as any to avoid fighting with the deep ServerClient generic
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeChain(result: unknown): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: Record<string, any> = {};
  for (const m of ["select", "eq", "neq", "gte", "lte", "gt", "in", "not", "order", "limit"]) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.returns = vi.fn().mockResolvedValue(result);
  chain.single = vi.fn().mockResolvedValue(result);
  chain.maybeSingle = vi.fn().mockResolvedValue(result);
  // thenable: count queries are awaited directly without calling a terminal method
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

/**
 * Build a supabase stub where each `from(table)` call pops the next result
 * from the per-table queue.  Unknown tables default to `{ data: null, error: null }`.
 */
function makeFlexSupabase(queues: Record<string, unknown[]>) {
  const counters: Record<string, number> = {};
  return {
    from: vi.fn((table: string) => {
      const queue = queues[table] ?? [];
      const i = counters[table] ?? 0;
      counters[table] = i + 1;
      return makeChain(queue[i] ?? { data: null, error: null });
    }),
  } as unknown as Parameters<typeof studentDashboardView>[0];
}

/** Baseline opts (current year, no monthEnd). */
const BASE_OPTS: StudentDashboardViewOpts = {
  now: new Date("2026-06-28T10:00:00Z"),
  isCurrentYear: true,
  yearStart: "2026-01-01T00:00:00.000Z",
  yearEnd: "2026-12-31T23:59:59.999Z",
  monthStart: "2026-06-01T00:00:00.000Z",
  monthEnd: undefined,
};

/** Default stub return values for helpers used in the core view. */
function stubCoreHelpers() {
  vi.mocked(getStudentContinueWatching).mockResolvedValue([]);
  vi.mocked(getStudentNextQuiz).mockResolvedValue(null as never);
  vi.mocked(getStudentStreak).mockResolvedValue({
    streak: 0,
    weeklyMinutes: 0,
    weeklyDelta: 0,
    loggedToday: false,
  } as never);
  vi.mocked(getStudentHomeworkPulse).mockResolvedValue({
    overdue: 0,
    dueToday: 0,
    dueThisWeek: 0,
    nextItem: null,
  } as never);
}

// ── studentMurajaahWidgetData ─────────────────────────────────────────────────

describe("studentMurajaahWidgetData", () => {
  beforeEach(() => vi.clearAllMocks());

  it("delegates directly to getTodaysMurajaahBatch and returns its result", async () => {
    const items = [{ surah: 2, ayah: 1, dueDate: "2026-06-27" }];
    vi.mocked(getTodaysMurajaahBatch).mockResolvedValue(items as never);

    const supabase = makeSupabase();
    const result = await studentMurajaahWidgetData(supabase, STUDENT_ID);

    expect(getTodaysMurajaahBatch).toHaveBeenCalledOnce();
    expect(getTodaysMurajaahBatch).toHaveBeenCalledWith(supabase, STUDENT_ID);
    expect(result).toBe(items);
  });

  it("returns an empty array when there are no due items", async () => {
    vi.mocked(getTodaysMurajaahBatch).mockResolvedValue([]);

    const result = await studentMurajaahWidgetData(makeSupabase(), STUDENT_ID);
    expect(result).toEqual([]);
  });
});

// ── studentAnalyticsWidgetData ────────────────────────────────────────────────

describe("studentAnalyticsWidgetData", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sets continueIsLessons=false and uses recentRecordings when continueWatching is empty", async () => {
    const recordings = [{ id: "rec-1", subject: "Fatiha" }];
    vi.mocked(getStudentStudyAnalytics).mockResolvedValue(EMPTY_ANALYTICS as never);
    vi.mocked(getStudentLiveSessions).mockResolvedValue([]);
    vi.mocked(getStudentContinueWatching).mockResolvedValue([]);
    vi.mocked(getStudentRecentRecordings).mockResolvedValue(recordings as never);

    const result = await studentAnalyticsWidgetData(makeSupabase(), STUDENT_ID);

    expect(result.continueIsLessons).toBe(false);
    expect(result.watchingRows).toEqual(recordings);
  });

  it("sets continueIsLessons=true and uses continueWatching rows when non-empty", async () => {
    const continuing = [{ id: "lesson-1", subject: "Al-Baqarah" }];
    const recordings = [{ id: "rec-1", subject: "Fatiha" }];
    vi.mocked(getStudentStudyAnalytics).mockResolvedValue(EMPTY_ANALYTICS as never);
    vi.mocked(getStudentLiveSessions).mockResolvedValue([]);
    vi.mocked(getStudentContinueWatching).mockResolvedValue(continuing as never);
    vi.mocked(getStudentRecentRecordings).mockResolvedValue(recordings as never);

    const result = await studentAnalyticsWidgetData(makeSupabase(), STUDENT_ID);

    expect(result.continueIsLessons).toBe(true);
    expect(result.watchingRows).toBe(continuing);
    // recentRecordings was not used
    expect(result.watchingRows).not.toBe(recordings);
  });

  it("maps each hw status to its distinct count", async () => {
    vi.mocked(getStudentStudyAnalytics).mockResolvedValue(EMPTY_ANALYTICS as never);
    vi.mocked(getStudentLiveSessions).mockResolvedValue([]);
    vi.mocked(getStudentContinueWatching).mockResolvedValue([]);
    vi.mocked(getStudentRecentRecordings).mockResolvedValue([]);

    // One distinct count per status so a miswired bucket would fail the assertion.
    const distinctCounts = [1, 2, 3, 4, 5, 6] as const;
    const result = await studentAnalyticsWidgetData(makeSupabase([...distinctCounts]), STUDENT_ID);

    expect(result.hwCounts).toEqual({
      assigned: 1,
      student_ready: 2,
      completed_excellent: 3,
      completed_good: 4,
      completed_needs_work: 5,
      completed_not_done: 6,
    });
    expect(result.anyFailed).toBe(false);
  });

  it("sets anyFailed=true when any hw HEAD count query fails", async () => {
    vi.mocked(getStudentStudyAnalytics).mockResolvedValue(EMPTY_ANALYTICS as never);
    vi.mocked(getStudentLiveSessions).mockResolvedValue([]);
    vi.mocked(getStudentContinueWatching).mockResolvedValue([]);
    vi.mocked(getStudentRecentRecordings).mockResolvedValue([]);

    // null in position 0 simulates a failed HEAD query for "assigned"
    const result = await studentAnalyticsWidgetData(makeSupabase([null, 1, 1, 1, 1, 1]), STUDENT_ID);

    expect(result.anyFailed).toBe(true);
    // failed query falls back to 0, not a phantom non-zero count
    expect(result.hwCounts.assigned).toBe(0);
  });

  it("passes studyAnalytics and liveSessions through from helpers", async () => {
    const analytics = {
      daily: [{ day: "Mon", value: 5, isActive: true }],
      weekly: [],
      monthly: [],
    };
    const sessions = [{ id: "s1", title: "Class", subtitle: "Now", initials: "AB" }];

    vi.mocked(getStudentStudyAnalytics).mockResolvedValue(analytics as never);
    vi.mocked(getStudentLiveSessions).mockResolvedValue(sessions as never);
    vi.mocked(getStudentContinueWatching).mockResolvedValue([]);
    vi.mocked(getStudentRecentRecordings).mockResolvedValue([]);

    const result = await studentAnalyticsWidgetData(makeSupabase(), STUDENT_ID);

    expect(result.studyAnalytics).toBe(analytics);
    expect(result.liveSessions).toBe(sessions);
  });
});

// ── studentDashboardView ──────────────────────────────────────────────────────
// These tests cover the main above-fold read bundle (lines 150-382 of the
// source), which the widget-only tests above left uncovered.

describe("studentDashboardView", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns isNewStudent=true (short-circuit) when totals are all zero and no active subscription", async () => {
    stubCoreHelpers();
    const supabase = makeFlexSupabase({
      // from("bookings") is called 4× before isNewStudent check:
      //   [0] totalQ  [1] monthQ  [2] nextBooking  [3] pending
      bookings: [
        { count: 0, error: null },
        { count: 0, error: null },
        { data: [], error: null },
        { count: 0, error: null },
      ],
      profiles: [{ data: { full_name: "Ali Hassan" }, error: null }],
      subscriptions: [{ count: 0, error: null }],
      conversations: [{ data: [], error: null }],
    });

    const result = await studentDashboardView(supabase, STUDENT_ID, BASE_OPTS);

    expect(result.isNewStudent).toBe(true);
    expect(result.anyFailed).toBe(false);
    expect(result.data.fullName).toBe("Ali Hassan");
    expect(result.data.totalSessions).toBe(0);
    expect(result.data.achievements).toEqual([]);
  });

  it("returns full data when student has activity but no nextBooking (isCurrentYear=true, monthEnd=undefined, streak<7)", async () => {
    stubCoreHelpers();
    vi.mocked(getStudentStreak).mockResolvedValue({
      streak: 3,
      weeklyMinutes: 45,
      weeklyDelta: 5,
      loggedToday: true,
    } as never);
    vi.mocked(getStudentNextQuiz).mockResolvedValue({
      id: "q1",
      title: "Surah Quiz",
      due_at: null,
    } as never);

    const supabase = makeFlexSupabase({
      // bookings: [0]=totalQ [1]=monthQ [2]=nextBooking [3]=pending [4]=todaySessions
      bookings: [
        { count: 5, error: null },
        { count: 2, error: null },
        { data: [], error: null },
        { count: 1, error: null },
        { data: [], error: null },
      ],
      profiles: [{ data: { full_name: "Ali Hassan" }, error: null }],
      subscriptions: [{ count: 0, error: null }],
      conversations: [{ data: [], error: null }],
      student_packages: [{ data: [], error: null }],
      student_progress: [{ data: null, error: null }],
      session_evaluations: [{ data: null, error: null }],
      achievements: [{ data: [], error: null }],
      homework_assignments: [{ data: [], error: null }],
    });

    const result = await studentDashboardView(supabase, STUDENT_ID, BASE_OPTS);

    expect(result.isNewStudent).toBe(false);
    expect(result.data.fullName).toBe("Ali Hassan");
    expect(result.data.totalSessions).toBe(5);
    expect(result.data.monthSessions).toBe(2);
    expect(result.data.pendingBookings).toBe(1);
    expect(result.data.nextBooking).toBeNull();
    expect(result.data.sessionId).toBeNull();
    expect(result.data.resumeLesson).toBeNull();
    expect(result.data.achievements).toEqual([]);
    // streak < 7 → after() never invoked
    expect(vi.mocked(after)).not.toHaveBeenCalled();
  });

  it("handles nextBooking, streak≥30, resumeLesson, today teacher lookup, achievements error, scoped year + monthEnd", async () => {
    stubCoreHelpers();
    vi.mocked(getStudentContinueWatching).mockResolvedValue([
      { _lessonId: "lesson-1", _href: "/lessons/lesson-1", subject: "Al-Baqarah", progress: 72 },
    ] as never);
    vi.mocked(getStudentStreak).mockResolvedValue({
      streak: 35,
      weeklyMinutes: 180,
      weeklyDelta: 60,
      loggedToday: true,
    } as never);
    vi.mocked(getStudentHomeworkPulse).mockResolvedValue({
      overdue: 2,
      dueToday: 1,
      dueThisWeek: 3,
      nextItem: null,
    } as never);

    const supabase = makeFlexSupabase({
      // bookings: [0]=totalQ [1]=monthQ [2]=nextBooking [3]=pending [4]=todaySessions
      bookings: [
        { count: 20, error: null },
        { count: 5, error: null },
        {
          data: [{
            id: "b1", teacher_id: "t1",
            scheduled_at: "2026-06-29T10:00:00Z",
            duration_min: 60, session_type: "hifz",
          }],
          error: null,
        },
        { count: 0, error: null },
        {
          data: [{
            id: "b2", teacher_id: "t2",
            scheduled_at: "2026-06-28T14:00:00Z",
            duration_min: 45, session_type: "review", status: "confirmed",
          }],
          error: null,
        },
      ],
      // profiles: [0]=student [1]=teacher (batch-2 nextBooking fan-out) [2]=today-teacher names
      profiles: [
        { data: { full_name: "Ali Hassan" }, error: null },
        { data: { full_name: "Sheikh Ibrahim" }, error: null },
        { data: [{ id: "t2", full_name: "Sheikh Omar" }], error: null },
      ],
      subscriptions: [{ count: 1, error: null }],
      conversations: [{ data: [], error: null }],
      sessions: [{ data: { id: "session-1" }, error: null }],
      student_packages: [{ data: [], error: null }],
      student_progress: [{ data: null, error: null }],
      session_evaluations: [{ data: null, error: null }],
      // achievements with error → exercises the achievementsErr branch
      achievements: [{ data: null, error: { message: "DB error" } }],
      homework_assignments: [{ data: [], error: null }],
    });

    const opts: StudentDashboardViewOpts = {
      ...BASE_OPTS,
      isCurrentYear: false,   // → exercises the totalQ.gte().lte() branch
      monthEnd: "2026-06-30T23:59:59.999Z",  // → exercises monthQ.lte() branch
    };

    const result = await studentDashboardView(supabase, STUDENT_ID, opts);

    expect(result.isNewStudent).toBe(false);
    expect(result.data.nextBooking).not.toBeNull();
    expect(result.data.sessionId).toBe("session-1");
    expect(result.data.resumeLesson).toEqual({
      lessonId: "lesson-1",
      title: "Al-Baqarah",
      href: "/lessons/lesson-1",
      progressPct: 72,
    });
    // streak≥30 and streak≥7 → after() called twice (one per badge)
    expect(vi.mocked(after)).toHaveBeenCalledTimes(2);
    // achievements error → logError called
    expect(vi.mocked(logError)).toHaveBeenCalled();
    expect(result.data.achievements).toEqual([]);
    // teacher name maps populated for both next-booking teacher and today-session teacher
    expect(result.data.nameMap).toMatchObject({ t1: "Sheikh Ibrahim", t2: "Sheikh Omar" });
  });

  it("covers streak≥7 but <30 (only the streak_7 badge fires)", async () => {
    stubCoreHelpers();
    vi.mocked(getStudentStreak).mockResolvedValue({
      streak: 10,
      weeklyMinutes: 60,
      weeklyDelta: 10,
      loggedToday: false,
    } as never);

    const supabase = makeFlexSupabase({
      bookings: [
        { count: 8, error: null },
        { count: 3, error: null },
        { data: [], error: null },
        { count: 0, error: null },
        { data: [], error: null },
      ],
      profiles: [{ data: { full_name: "Student B" }, error: null }],
      subscriptions: [{ count: 0, error: null }],
      conversations: [{ data: [], error: null }],
      student_packages: [{ data: [], error: null }],
      student_progress: [{ data: null, error: null }],
      session_evaluations: [{ data: null, error: null }],
      achievements: [{ data: [], error: null }],
      homework_assignments: [{ data: [], error: null }],
    });

    const result = await studentDashboardView(supabase, STUDENT_ID, BASE_OPTS);

    // streak_7 fires, streak_30 does not
    expect(vi.mocked(after)).toHaveBeenCalledTimes(1);
    expect(result.data.streakInfo.streak).toBe(10);
  });

  it("surfaces subscription summary, unread messages, and rich evaluation (S1/S2/S3)", async () => {
    stubCoreHelpers();

    const supabase = makeFlexSupabase({
      // [0]=totalQ [1]=monthQ [2]=nextBooking [3]=pending [4]=todaySessions
      bookings: [
        { count: 12, error: null },
        { count: 3, error: null },
        { data: [], error: null },
        { count: 0, error: null },
        { data: [], error: null },
      ],
      profiles: [{ data: { full_name: "Fatima" }, error: null }],
      // [0]=Batch-1 active-sub count  [1]=Batch-3 subscription row
      subscriptions: [
        { count: 1, error: null },
        {
          data: {
            plan_id: "plan-9",
            status: "active",
            current_period_end: "2026-08-01T00:00:00Z",
            cancel_at_period_end: false,
          },
          error: null,
        },
      ],
      subscription_plans: [{ data: { name: "Hifz Premium" }, error: null }],
      conversations: [{ data: [{ id: "c1" }, { id: "c2" }], error: null }],
      messages: [{ count: 4, error: null }],
      student_packages: [{ data: [], error: null }],
      student_progress: [{ data: null, error: null }],
      session_evaluations: [{
        data: {
          overall_score: 8,
          strengths: "Strong tajweed",
          next_goals: "Finish Juz 3",
          evaluation_type: "weekly",
          created_at: "2026-06-20T00:00:00Z",
        },
        error: null,
      }],
      achievements: [{ data: [], error: null }],
      homework_assignments: [{ data: [], error: null }],
    });

    const result = await studentDashboardView(supabase, STUDENT_ID, BASE_OPTS);

    // S1 — active subscription summarized with the resolved plan name.
    expect(result.data.subscription).toEqual({
      planName: "Hifz Premium",
      status: "active",
      currentPeriodEnd: "2026-08-01T00:00:00Z",
      cancelAtPeriodEnd: false,
    });
    // S2 — unread count derived from the student's conversations.
    expect(result.data.unreadMessages).toBe(4);
    // S3 — evaluation now carries rating + strengths, not only next_goals.
    expect(result.data.latestEvaluation).toEqual({
      overall_score: 8,
      strengths: "Strong tajweed",
      next_goals: "Finish Juz 3",
      evaluation_type: "weekly",
      created_at: "2026-06-20T00:00:00Z",
    });
  });

  it("populates the prepaid-hour wallet summary when the student has active lots (spec 038)", async () => {
    stubCoreHelpers();

    const supabase = makeFlexSupabase({
      bookings: [
        { count: 4, error: null },
        { count: 1, error: null },
        { data: [], error: null },
        { count: 0, error: null },
        { data: [], error: null },
      ],
      profiles: [{ data: { full_name: "Yusuf" }, error: null }],
      subscriptions: [{ count: 0, error: null }],
      conversations: [{ data: [], error: null }],
      // student_packages is queried three times: [0] Batch-1 prepaid-hours
      // HEAD count (isNewStudent guard), [1] active-packages widget (empty),
      // [2] prepaid-lots (spec 038) — the data under test.
      student_packages: [
        { count: 2, error: null },
        { data: [], error: null },
        {
        data: [
          {
            id: "lot-old",
            sessions_total: 10,
            sessions_used: 10,
            status: "active",
            expires_at: "2026-05-01T00:00:00Z",
            rate_paid_usd: 7,
            purchased_at: "2026-01-01T00:00:00Z",
          },
          {
            id: "lot-new",
            sessions_total: 8,
            sessions_used: 3,
            status: "active",
            expires_at: "2026-09-01T00:00:00Z",
            rate_paid_usd: 6.5,
            purchased_at: "2026-05-01T00:00:00Z",
          },
          {
            // A second lot with hours left AND a valid expiry, earlier than
            // lot-new's — makes the nearest-expiry candidate list length 2+
            // so the `.sort()` comparator actually runs (not just `.filter`).
            id: "lot-soonest",
            sessions_total: 6,
            sessions_used: 2,
            status: "active",
            expires_at: "2026-07-01T00:00:00Z",
            rate_paid_usd: 8,
            purchased_at: "2026-06-01T00:00:00Z",
          },
          {
            // Has hours left but no expiry date set — must be excluded from
            // the nearest-expiry candidates by the `l.lot.expires_at` half
            // of the filter's `&&`, not just the `remaining > 0` half.
            id: "lot-no-expiry",
            sessions_total: 4,
            sessions_used: 1,
            status: "active",
            expires_at: null,
            rate_paid_usd: 5,
            purchased_at: "2026-04-01T00:00:00Z",
          },
        ],
        error: null,
      }],
      prepaid_hours_events: [{
        data: [
          { event_type: "purchase", hours_delta: 8, created_at: "2026-05-01T00:00:00Z" },
          { event_type: "spend", hours_delta: -3, created_at: "2026-06-01T00:00:00Z" },
        ],
        error: null,
      }],
      student_progress: [{ data: null, error: null }],
      session_evaluations: [{ data: null, error: null }],
      achievements: [{ data: [], error: null }],
      homework_assignments: [{ data: [], error: null }],
    });

    const result = await studentDashboardView(supabase, STUDENT_ID, BASE_OPTS);

    // lot-old is fully used (remaining=0); lot-no-expiry has hours left but
    // no expiry date — both excluded from the nearest-expiry candidates.
    // lot-soonest and lot-new both qualify (hours left + valid expiry),
    // exercising the candidate-list `.sort()`: the EARLIER one (lot-soonest)
    // wins nearestExpiry, not just whichever lot appears first in the array.
    // All four lots are still listed, sorted newest-purchased-first;
    // balanceHours sums remaining across all four.
    expect(result.data.prepaidWallet).toEqual({
      balanceHours: 12,
      nearestExpiry: "2026-07-01T00:00:00Z",
      lots: [
        {
          id: "lot-soonest",
          sessionsTotal: 6,
          sessionsUsed: 2,
          remaining: 4,
          expiresAt: "2026-07-01T00:00:00Z",
          ratePaidUsd: 8,
          purchasedAt: "2026-06-01T00:00:00Z",
        },
        {
          id: "lot-new",
          sessionsTotal: 8,
          sessionsUsed: 3,
          remaining: 5,
          expiresAt: "2026-09-01T00:00:00Z",
          ratePaidUsd: 6.5,
          purchasedAt: "2026-05-01T00:00:00Z",
        },
        {
          id: "lot-no-expiry",
          sessionsTotal: 4,
          sessionsUsed: 1,
          remaining: 3,
          expiresAt: null,
          ratePaidUsd: 5,
          purchasedAt: "2026-04-01T00:00:00Z",
        },
        {
          id: "lot-old",
          sessionsTotal: 10,
          sessionsUsed: 10,
          remaining: 0,
          expiresAt: "2026-05-01T00:00:00Z",
          ratePaidUsd: 7,
          purchasedAt: "2026-01-01T00:00:00Z",
        },
      ],
      history: [
        { eventType: "purchase", hoursDelta: 8, createdAt: "2026-05-01T00:00:00Z" },
        { eventType: "spend", hoursDelta: -3, createdAt: "2026-06-01T00:00:00Z" },
      ],
    });
  });

  it("logs (never throws) when the fire-and-forget streak-badge award rejects", async () => {
    stubCoreHelpers();
    vi.mocked(getStudentStreak).mockResolvedValue({
      streak: 35, // ≥30 and ≥7 → both badges fire
      weeklyMinutes: 200,
      weeklyDelta: 60,
      loggedToday: true,
    } as never);
    // Production code passes `after()` a fire-and-forget callback it never
    // awaits — invoke it synchronously here so the test can observe the
    // award + its `.catch()` error handler, instead of leaving them
    // permanently dead code under the mock's default no-op.
    vi.mocked(after).mockImplementation(((cb: () => void) => cb()) as never);
    vi.mocked(awardAchievement).mockRejectedValue(new Error("award insert failed"));

    const supabase = makeFlexSupabase({
      bookings: [
        { count: 8, error: null },
        { count: 3, error: null },
        { data: [], error: null },
        { count: 0, error: null },
        { data: [], error: null },
      ],
      profiles: [{ data: { full_name: "Streaker" }, error: null }],
      subscriptions: [{ count: 0, error: null }],
      conversations: [{ data: [], error: null }],
      student_packages: [{ count: 0, error: null }, { data: [], error: null }, { data: [], error: null }],
      prepaid_hours_events: [{ data: [], error: null }],
      student_progress: [{ data: null, error: null }],
      session_evaluations: [{ data: null, error: null }],
      achievements: [{ data: [], error: null }],
      homework_assignments: [{ data: [], error: null }],
    });

    await studentDashboardView(supabase, STUDENT_ID, BASE_OPTS);
    // Flush the microtask queue so the fire-and-forget .catch() handlers run
    // before asserting on their side effect.
    await new Promise((resolve) => setImmediate(resolve));

    expect(vi.mocked(after)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(awardAchievement)).toHaveBeenCalledWith(
      STUDENT_ID, "streak_30", { streak: 35 },
    );
    expect(vi.mocked(awardAchievement)).toHaveBeenCalledWith(
      STUDENT_ID, "streak_7", { streak: 35 },
    );
    expect(vi.mocked(logError)).toHaveBeenCalledWith(
      "streak_30 award failed", expect.any(Error), { tag: "achievements" },
    );
    expect(vi.mocked(logError)).toHaveBeenCalledWith(
      "streak_7 award failed", expect.any(Error), { tag: "achievements" },
    );
  });
});
