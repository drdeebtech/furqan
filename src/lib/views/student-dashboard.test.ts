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

// ── Mock dashboard-queries helpers ────────────────────────────────────────────
vi.mock("@/lib/dashboard-queries", () => ({
  getTodaysMurajaahBatch: vi.fn(),
  getStudentStudyAnalytics: vi.fn(),
  getStudentLiveSessions: vi.fn(),
  getStudentContinueWatching: vi.fn(),
  getStudentRecentRecordings: vi.fn(),
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
} from "./student-dashboard";
import {
  getTodaysMurajaahBatch,
  getStudentStudyAnalytics,
  getStudentLiveSessions,
  getStudentContinueWatching,
  getStudentRecentRecordings,
} from "@/lib/dashboard-queries";

// ── Helpers ───────────────────────────────────────────────────────────────────

const HW_STATUSES = [
  "assigned",
  "student_ready",
  "completed_excellent",
  "completed_good",
  "completed_needs_work",
  "completed_not_done",
] as const;

/** Build a minimal Supabase-like chain that resolves hwCount HEAD queries. */
function makeSupabase(hwCountOverride = 0) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    // `.then()` makes the chain thenable — resolves with a count result
    then: vi.fn((resolve: (v: { count: number | null }) => unknown) =>
      Promise.resolve({ count: hwCountOverride }).then(resolve)
    ),
  };
  return {
    from: vi.fn().mockReturnValue(chain),
  } as unknown as Parameters<typeof studentAnalyticsWidgetData>[0];
}

const STUDENT_ID = "student-abc-123";

const EMPTY_ANALYTICS = {
  daily: [],
  weekly: [],
  monthly: [],
};

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
    expect(result.watchingRows).toBe(recordings);
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

  it("returns hwCounts with all 6 status keys", async () => {
    vi.mocked(getStudentStudyAnalytics).mockResolvedValue(EMPTY_ANALYTICS as never);
    vi.mocked(getStudentLiveSessions).mockResolvedValue([]);
    vi.mocked(getStudentContinueWatching).mockResolvedValue([]);
    vi.mocked(getStudentRecentRecordings).mockResolvedValue([]);

    const result = await studentAnalyticsWidgetData(makeSupabase(3), STUDENT_ID);

    for (const status of HW_STATUSES) {
      expect(result.hwCounts).toHaveProperty(status);
      expect(typeof result.hwCounts[status]).toBe("number");
    }
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
