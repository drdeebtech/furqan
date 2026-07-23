import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const chain = vi.hoisted(() => ({
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  gte: vi.fn().mockReturnThis(),
  not: vi.fn().mockReturnThis(),
  returns: vi.fn(),
}));

import { getTeacherTeachingHours, _emptyDailyWindow } from "./teacher-hours";

const TEACHER = "teacher-aaa";

beforeEach(() => {
  vi.clearAllMocks();
  chain.from.mockReturnThis();
  chain.select.mockReturnThis();
  chain.eq.mockReturnThis();
  chain.in.mockReturnThis();
  chain.gte.mockReturnThis();
  chain.not.mockReturnThis();
});

describe("_emptyDailyWindow", () => {
  it("returns 30 zero-minute days, oldest first, ending at today", () => {
    const now = new Date("2026-06-22T12:00:00.000Z").getTime();
    const dayMs = 24 * 60 * 60 * 1000;
    const window = _emptyDailyWindow(now, dayMs);
    expect(window).toHaveLength(30);
    expect(window[0]).toEqual({ date: "2026-05-24", minutes: 0 });
    expect(window[29]).toEqual({ date: "2026-06-22", minutes: 0 });
  });
});

describe("getTeacherTeachingHours", () => {
  it("returns an all-zero summary with a full empty window when there are no bookings", async () => {
    chain.returns.mockResolvedValueOnce({ data: [], error: null });
    const summary = await getTeacherTeachingHours(chain as never, TEACHER);
    expect(summary.thisWeekMinutes).toBe(0);
    expect(summary.thisMonthMinutes).toBe(0);
    expect(summary.byTypeThisMonth).toEqual({});
    expect(summary.daily).toHaveLength(30);
  });

  it("throws when the bookings query errors", async () => {
    chain.returns.mockResolvedValueOnce({ data: null, error: new Error("db fail") });
    await expect(getTeacherTeachingHours(chain as never, TEACHER)).rejects.toThrow("db fail");
  });

  it("sums completed sessions into week/month/by-type/daily buckets", async () => {
    const now = Date.now();
    const twoDaysAgo = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(); // in the 7-day window
    const twentyDaysAgo = new Date(now - 20 * 24 * 60 * 60 * 1000).toISOString(); // in 30-day, not 7-day

    chain.returns
      .mockResolvedValueOnce({
        data: [
          { id: "b1", session_type: "hifz", scheduled_at: twoDaysAgo },
          { id: "b2", session_type: "tajweed", scheduled_at: twentyDaysAgo },
        ],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [
          { booking_id: "b1", actual_duration: 30, started_at: twoDaysAgo, ended_at: twoDaysAgo },
          { booking_id: "b2", actual_duration: 45, started_at: twentyDaysAgo, ended_at: twentyDaysAgo },
        ],
        error: null,
      });

    const summary = await getTeacherTeachingHours(chain as never, TEACHER);
    expect(summary.thisWeekMinutes).toBe(30);
    expect(summary.thisMonthMinutes).toBe(75);
    expect(summary.byTypeThisMonth).toEqual({ hifz: 30, tajweed: 45 });
    const nonZeroDays = summary.daily.filter((d) => d.minutes > 0);
    expect(nonZeroDays).toHaveLength(2);
  });

  it("scopes the bookings fetch to the last 30 days", async () => {
    chain.returns.mockResolvedValueOnce({ data: [], error: null });
    await getTeacherTeachingHours(chain as never, TEACHER);
    expect(chain.gte).toHaveBeenCalledWith("scheduled_at", expect.any(String));
  });
});
