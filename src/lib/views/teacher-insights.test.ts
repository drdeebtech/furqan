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

import { getTeacherTimeToGrade, getTeacherRosterErrorPulse } from "./teacher-insights";

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
