import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const chain = vi.hoisted(() => ({
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  not: vi.fn().mockReturnThis(),
  gte: vi.fn().mockReturnThis(),
  returns: vi.fn(),
}));

import { getTeacherTimeToGrade, getTeacherRosterErrorPulse, getTeacherMurajaahHealth } from "./teacher-insights";

const TEACHER = "teacher-aaa";

beforeEach(() => {
  vi.clearAllMocks();
  chain.from.mockReturnThis();
  chain.select.mockReturnThis();
  chain.eq.mockReturnThis();
  chain.in.mockReturnThis();
  chain.not.mockReturnThis();
  chain.gte.mockReturnThis();
});

// ready_at fixed at midnight; completed_at offset by `h` hours.
function row(h: number) {
  const ready = "2026-06-01T00:00:00.000Z";
  const completed = new Date(Date.parse(ready) + h * 60 * 60 * 1000).toISOString();
  return { ready_at: ready, completed_at: completed };
}

describe("getTeacherTimeToGrade", () => {
  it("computes median + p90 (rounded to 1dp) for a valid sample", async () => {
    chain.returns.mockResolvedValueOnce({ data: [row(10), row(20), row(30)], error: null });
    const result = await getTeacherTimeToGrade(chain as never, TEACHER);
    expect(result).toEqual({ medianHours: 20, p90Hours: 30, sampleSize: 3 });
  });

  it("returns nulls when fewer than 3 graded items", async () => {
    chain.returns.mockResolvedValueOnce({ data: [row(10), row(20)], error: null });
    const result = await getTeacherTimeToGrade(chain as never, TEACHER);
    expect(result).toEqual({ medianHours: null, p90Hours: null, sampleSize: 2 });
  });

  it("filters out impossible negative durations", async () => {
    // 3 valid + 1 negative → sample stays 3, stats from the valid rows only.
    chain.returns.mockResolvedValueOnce({
      data: [row(10), row(20), row(30), row(-5)],
      error: null,
    });
    const result = await getTeacherTimeToGrade(chain as never, TEACHER);
    expect(result).toEqual({ medianHours: 20, p90Hours: 30, sampleSize: 3 });
  });

  it("returns nulls when negatives drop the sample below 3", async () => {
    chain.returns.mockResolvedValueOnce({
      data: [row(10), row(20), row(-5), row(-9)],
      error: null,
    });
    const result = await getTeacherTimeToGrade(chain as never, TEACHER);
    expect(result).toEqual({ medianHours: null, p90Hours: null, sampleSize: 2 });
  });

  it("throws when the query errors", async () => {
    chain.returns.mockResolvedValueOnce({ data: null, error: new Error("db fail") });
    await expect(getTeacherTimeToGrade(chain as never, TEACHER)).rejects.toThrow("db fail");
  });
});

describe("getTeacherRosterErrorPulse", () => {
  // Single join query: recitation_errors embedding student_progress!inner,
  // so the mock resolves once with the error rows directly (issue #559).
  it("returns [] when the join yields no error rows in window", async () => {
    chain.returns.mockResolvedValueOnce({ data: [], error: null });
    const result = await getTeacherRosterErrorPulse(chain as never, TEACHER);
    expect(result).toEqual([]);
    // Guard the join refactor (issue #559): a dropped filter or malformed
    // embedded select would otherwise pass silently because the chain mock
    // returns `this` regardless of arguments.
    expect(chain.from).toHaveBeenCalledWith("recitation_errors");
    expect(chain.select).toHaveBeenCalledWith(
      "error_type, note, student_progress!inner(teacher_id, created_at)",
    );
    expect(chain.eq).toHaveBeenCalledWith("student_progress.teacher_id", TEACHER);
  });

  it("excludes sentinel rows, buckets unknown types as 'other', and returns top-3 desc", async () => {
    chain.returns.mockResolvedValueOnce({
      data: [
        { error_type: "makharij", note: null },
        { error_type: "makharij", note: null },
        { error_type: "makharij", note: null },
        { error_type: "sifat", note: null },
        { error_type: "sifat", note: null },
        { error_type: "madd", note: null },
        { error_type: "waqf", note: null },
        { error_type: "xyz-unknown", note: null }, // → other
        { error_type: "madd", note: "__no_errors_observed_sentinel__" }, // skipped
        { error_type: "sifat", note: "__no_errors_observed_sentinel__" }, // skipped
      ],
      error: null,
    });

    const result = await getTeacherRosterErrorPulse(chain as never, TEACHER);
    expect(result).toEqual([
      { category: "makharij", count: 3 },
      { category: "sifat", count: 2 },
      { category: "madd", count: 1 },
    ]);
  });

  it("returns [] when every error row is a no-errors sentinel", async () => {
    chain.returns.mockResolvedValueOnce({
      data: [
        { error_type: "madd", note: "__no_errors_observed_sentinel__" },
        { error_type: "sifat", note: "__no_errors_observed_sentinel__" },
      ],
      error: null,
    });
    const result = await getTeacherRosterErrorPulse(chain as never, TEACHER);
    expect(result).toEqual([]);
  });

  it("throws when the query errors", async () => {
    chain.returns.mockResolvedValueOnce({ data: null, error: new Error("db fail") });
    await expect(getTeacherRosterErrorPulse(chain as never, TEACHER)).rejects.toThrow("db fail");
  });
});

// ─── getTeacherMurajaahHealth ────────────────────────────────────────────────

/** ISO timestamp offset from now by `daysAgo` (negative = future). */
function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

const STUDENT_A = "student-aaa";
const STUDENT_B = "student-bbb";

/** Mock the two-query sequence: schedule rows + profile rows. */
function mockMurajaahQueries(
  schedRows: { student_id: string; easiness_factor: number; next_review_at: string; last_reviewed_at: string | null }[],
  profileRows: { id: string; full_name: string | null }[] = [],
) {
  chain.returns
    .mockResolvedValueOnce({ data: schedRows, error: null })   // schedule query
    .mockResolvedValueOnce({ data: profileRows, error: null }); // name resolution
}

describe("getTeacherMurajaahHealth", () => {
  it("returns [] when no schedule rows exist for the teacher", async () => {
    chain.returns.mockResolvedValueOnce({ data: [], error: null });
    const result = await getTeacherMurajaahHealth(chain as never, TEACHER);
    expect(result).toEqual([]);
    // Guard query shape: single join with !inner to scope to teacher's students.
    expect(chain.from).toHaveBeenCalledWith("student_review_schedule");
    expect(chain.select).toHaveBeenCalledWith(
      "student_id, easiness_factor, next_review_at, last_reviewed_at, student_progress!inner(teacher_id)",
    );
    expect(chain.eq).toHaveBeenCalledWith("student_progress.teacher_id", TEACHER);
  });

  it("flags students overdue >3 days and counts correctly", async () => {
    mockMurajaahQueries(
      [
        { student_id: STUDENT_A, easiness_factor: 2.5, next_review_at: daysAgo(5), last_reviewed_at: daysAgo(5) },
        { student_id: STUDENT_A, easiness_factor: 2.5, next_review_at: daysAgo(4), last_reviewed_at: daysAgo(4) },
        { student_id: STUDENT_B, easiness_factor: 2.5, next_review_at: daysAgo(1), last_reviewed_at: daysAgo(1) },
      ],
      [
        { id: STUDENT_A, full_name: "Ahmed" },
        { id: STUDENT_B, full_name: "Bilal" },
      ],
    );
    const result = await getTeacherMurajaahHealth(chain as never, TEACHER);
    const a = result.find(r => r.studentId === STUDENT_A)!;
    const b = result.find(r => r.studentId === STUDENT_B)!;
    expect(a.overdueCount).toBe(2);
    expect(b.overdueCount).toBe(0);
    expect(a.studentName).toBe("Ahmed");
  });

  it("sorts worst-overdue students first", async () => {
    mockMurajaahQueries(
      [
        { student_id: STUDENT_B, easiness_factor: 2.5, next_review_at: daysAgo(4), last_reviewed_at: null },
        { student_id: STUDENT_A, easiness_factor: 2.5, next_review_at: daysAgo(5), last_reviewed_at: null },
        { student_id: STUDENT_A, easiness_factor: 2.5, next_review_at: daysAgo(6), last_reviewed_at: null },
      ],
      [],
    );
    const result = await getTeacherMurajaahHealth(chain as never, TEACHER);
    expect(result[0].studentId).toBe(STUDENT_A); // 2 overdue comes first
    expect(result[1].studentId).toBe(STUDENT_B); // 1 overdue
  });

  it("picks the most-recent last_reviewed_at per student", async () => {
    const older = daysAgo(10);
    const newer = daysAgo(3);
    mockMurajaahQueries(
      [
        { student_id: STUDENT_A, easiness_factor: 2.5, next_review_at: daysAgo(1), last_reviewed_at: older },
        { student_id: STUDENT_A, easiness_factor: 2.5, next_review_at: daysAgo(1), last_reviewed_at: newer },
      ],
      [],
    );
    const [result] = await getTeacherMurajaahHealth(chain as never, TEACHER);
    expect(result.lastReviewedAt).toBe(newer);
  });

  it("computes easeTrend: >2.6 = improving, <2.4 = declining, otherwise stable", async () => {
    mockMurajaahQueries(
      [
        { student_id: "s-improving", easiness_factor: 2.8, next_review_at: daysAgo(1), last_reviewed_at: null },
        { student_id: "s-declining", easiness_factor: 1.8, next_review_at: daysAgo(1), last_reviewed_at: null },
        { student_id: "s-stable",    easiness_factor: 2.5, next_review_at: daysAgo(1), last_reviewed_at: null },
      ],
      [],
    );
    const result = await getTeacherMurajaahHealth(chain as never, TEACHER);
    const trend = (id: string) => result.find(r => r.studentId === id)!.easeTrend;
    expect(trend("s-improving")).toBe("improving");
    expect(trend("s-declining")).toBe("declining");
    expect(trend("s-stable")).toBe("stable");
  });

  it("does NOT count a student overdue at exactly the 3-day boundary", async () => {
    // Frozen clock so the boundary is deterministic: overdue is strictly
    // >3 days (next_review_at < now - 3d). At exactly 3 days it must NOT count.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00.000Z"));
    try {
      const exactlyThreeDays = daysAgo(3);
      mockMurajaahQueries(
        [
          { student_id: STUDENT_A, easiness_factor: 2.5, next_review_at: exactlyThreeDays, last_reviewed_at: null },
        ],
        [{ id: STUDENT_A, full_name: "Ahmed" }],
      );
      const [result] = await getTeacherMurajaahHealth(chain as never, TEACHER);
      expect(result.overdueCount).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("breaks overdue ties deterministically by studentId ascending", async () => {
    // Both students share the same overdueCount; insertion order is B before A.
    // Without the studentId tie-break the result would echo insertion order (B, A).
    mockMurajaahQueries(
      [
        { student_id: STUDENT_B, easiness_factor: 2.5, next_review_at: daysAgo(5), last_reviewed_at: null },
        { student_id: STUDENT_A, easiness_factor: 2.5, next_review_at: daysAgo(5), last_reviewed_at: null },
      ],
      [],
    );
    const result = await getTeacherMurajaahHealth(chain as never, TEACHER);
    expect(result[0].overdueCount).toBe(result[1].overdueCount); // tie
    expect(result.map(r => r.studentId)).toEqual([STUDENT_A, STUDENT_B]);
  });

  it("throws when the schedule query errors", async () => {
    chain.returns.mockResolvedValueOnce({ data: null, error: new Error("sched fail") });
    await expect(getTeacherMurajaahHealth(chain as never, TEACHER)).rejects.toThrow("sched fail");
  });
});
