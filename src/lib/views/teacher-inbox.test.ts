import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const chain = vi.hoisted(() => ({
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  gte: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  returns: vi.fn(),
}));

import { getTeacherTalqeenInbox, getTeacherParentReportDigest } from "./teacher-inbox";

const TEACHER = "teacher-aaa";

beforeEach(() => {
  vi.clearAllMocks();
  chain.from.mockReturnThis();
  chain.select.mockReturnThis();
  chain.eq.mockReturnThis();
  chain.in.mockReturnThis();
  chain.gte.mockReturnThis();
  chain.order.mockReturnThis();
  chain.limit.mockReturnThis();
});

describe("getTeacherTalqeenInbox", () => {
  it("resolves student names (missing id → —) and uses the exact count for totalCount", async () => {
    chain.returns
      .mockResolvedValueOnce({
        data: [
          { id: "h1", title: "Al-Fatiha", student_id: "s1", audio_duration_seconds: 42, ready_at: "2026-06-21T10:00:00.000Z" },
          { id: "h2", title: "Al-Baqarah", student_id: "s2", audio_duration_seconds: null, ready_at: null },
        ],
        count: 12,
        error: null,
      })
      .mockResolvedValueOnce({ data: [{ id: "s1", full_name: "Aisha" }], error: null }); // s2 missing

    const result = await getTeacherTalqeenInbox(chain as never, TEACHER);
    expect(result.totalCount).toBe(12);
    expect(result.recent).toEqual([
      { id: "h1", title: "Al-Fatiha", studentName: "Aisha", audioDurationSeconds: 42, readyAt: "2026-06-21T10:00:00.000Z" },
      { id: "h2", title: "Al-Baqarah", studentName: "—", audioDurationSeconds: null, readyAt: null },
    ]);
  });

  it("returns an empty digest without resolving names when the inbox is empty", async () => {
    chain.returns.mockResolvedValueOnce({ data: [], count: 0, error: null });
    const result = await getTeacherTalqeenInbox(chain as never, TEACHER);
    expect(result).toEqual({ totalCount: 0, recent: [] });
    expect(chain.returns).toHaveBeenCalledTimes(1); // no name-resolve query
  });

  it("throws when the inbox query errors", async () => {
    chain.returns.mockResolvedValueOnce({ data: null, count: null, error: new Error("db fail") });
    await expect(getTeacherTalqeenInbox(chain as never, TEACHER)).rejects.toThrow("db fail");
  });
});

describe("getTeacherParentReportDigest", () => {
  it("groups by type (desc), resolves names, and derives the sent flag", async () => {
    chain.returns
      .mockResolvedValueOnce({
        data: [
          { id: "r1", report_type: "progress", student_id: "s1", sent_at: "2026-06-20T00:00:00.000Z", created_at: "2026-06-21T00:00:00.000Z" },
          { id: "r2", report_type: "behavior", student_id: "s2", sent_at: null, created_at: "2026-06-20T00:00:00.000Z" },
        ],
        count: 5,
        error: null,
      })
      .mockResolvedValueOnce({
        data: [
          { report_type: "progress" },
          { report_type: "progress" },
          { report_type: "behavior" },
          { report_type: "alert" },
        ],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [
          { id: "s1", full_name: "Aisha" },
          { id: "s2", full_name: null },
        ],
        error: null,
      });

    const result = await getTeacherParentReportDigest(chain as never, TEACHER);
    expect(result.totalCount).toBe(5);
    expect(result.byType).toEqual([
      { type: "progress", count: 2 },
      { type: "behavior", count: 1 },
      { type: "alert", count: 1 },
    ]);
    expect(result.recent).toEqual([
      { id: "r1", reportType: "progress", studentName: "Aisha", createdAt: "2026-06-21T00:00:00.000Z", sent: true },
      { id: "r2", reportType: "behavior", studentName: "—", createdAt: "2026-06-20T00:00:00.000Z", sent: false },
    ]);
  });

  it("returns an empty digest (no type/name queries) when nothing in window", async () => {
    chain.returns.mockResolvedValueOnce({ data: [], count: 0, error: null });
    const result = await getTeacherParentReportDigest(chain as never, TEACHER);
    expect(result).toEqual({ totalCount: 0, byType: [], recent: [] });
    expect(chain.returns).toHaveBeenCalledTimes(1);
  });

  it("does not return a false-empty digest when count is null but rows exist", async () => {
    // Regression: supabase-js types `count` as number | null. A null count
    // with populated rows must NOT collapse to an empty digest — the
    // empty-state is decided by the rows, and totalCount falls back to the
    // full type-fetch length.
    chain.returns
      .mockResolvedValueOnce({
        data: [
          { id: "r1", report_type: "progress", student_id: "s1", sent_at: null, created_at: "2026-06-21T00:00:00.000Z" },
        ],
        count: null,
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ report_type: "progress" }, { report_type: "behavior" }],
        error: null,
      })
      .mockResolvedValueOnce({ data: [{ id: "s1", full_name: "Aisha" }], error: null });

    const result = await getTeacherParentReportDigest(chain as never, TEACHER);
    expect(chain.returns).toHaveBeenCalledTimes(3); // not short-circuited
    expect(result.totalCount).toBe(2); // fallback to full type-fetch length
    expect(result.byType).toEqual([
      { type: "progress", count: 1 },
      { type: "behavior", count: 1 },
    ]);
    expect(result.recent).toEqual([
      { id: "r1", reportType: "progress", studentName: "Aisha", createdAt: "2026-06-21T00:00:00.000Z", sent: false },
    ]);
  });

  describe("7-day window boundary", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-06-22T00:00:00.000Z"));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("filters created_at by the 7-day-ago ISO", async () => {
      chain.returns.mockResolvedValueOnce({ data: [], count: 0, error: null });
      await getTeacherParentReportDigest(chain as never, TEACHER);
      expect(chain.gte).toHaveBeenCalledWith("created_at", "2026-06-15T00:00:00.000Z");
    });
  });
});
