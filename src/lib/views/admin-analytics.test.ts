import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const chain = vi.hoisted(() => ({
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  is: vi.fn().mockReturnThis(),
  gte: vi.fn().mockReturnThis(),
  lte: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  returns: vi.fn(),
}));

import { getActiveUserCounts, getTeacherCompletionRates } from "./admin-analytics";

const NOW = new Date("2026-06-15T12:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  chain.from.mockReturnThis();
  chain.select.mockReturnThis();
  chain.eq.mockReturnThis();
  chain.in.mockReturnThis();
  chain.is.mockReturnThis();
  chain.gte.mockReturnThis();
  chain.lte.mockReturnThis();
  chain.order.mockReturnThis();
  chain.limit.mockReturnThis();
});

function session(startedAt: string, student_id: string, teacher_id: string) {
  return { started_at: startedAt, bookings: { student_id, teacher_id } };
}

describe("getActiveUserCounts", () => {
  it("buckets distinct students/teachers into DAU/WAU/MAU windows", async () => {
    chain.returns.mockResolvedValueOnce({
      data: [
        session("2026-06-15T10:00:00.000Z", "S1", "T1"), // within 1d
        session("2026-06-10T10:00:00.000Z", "S2", "T1"), // within 7d, not 1d
        session("2026-06-01T10:00:00.000Z", "S1", "T2"), // within 30d, not 7d
      ],
      error: null,
    });

    const result = await getActiveUserCounts(chain as never, NOW);

    expect(result).toEqual({
      students: { dau: 1, wau: 2, mau: 2 },
      teachers: { dau: 1, wau: 1, mau: 2 },
      capped: false,
    });
  });

  it("returns zeros (not capped) for an empty window", async () => {
    chain.returns.mockResolvedValueOnce({ data: [], error: null });
    const result = await getActiveUserCounts(chain as never, NOW);
    expect(result).toEqual({
      students: { dau: 0, wau: 0, mau: 0 },
      teachers: { dau: 0, wau: 0, mau: 0 },
      capped: false,
    });
  });

  it("throws when the query errors", async () => {
    chain.returns.mockResolvedValueOnce({ data: null, error: { message: "db fail" } });
    await expect(getActiveUserCounts(chain as never, NOW)).rejects.toThrow("db fail");
  });
});

describe("getTeacherCompletionRates", () => {
  it("computes per-teacher completion rate, worst first", async () => {
    // 1st query: bookings; 2nd query: buildNameMap public_profiles lookup.
    chain.returns
      .mockResolvedValueOnce({
        data: [
          { teacher_id: "T1", status: "completed" },
          { teacher_id: "T1", status: "completed" },
          { teacher_id: "T1", status: "no_show" },
          { teacher_id: "T2", status: "confirmed" },
        ],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [
          { id: "T1", full_name: "Teacher One" },
          { id: "T2", full_name: "Teacher Two" },
        ],
        error: null,
      });

    const result = await getTeacherCompletionRates(chain as never, NOW);

    expect(result).toEqual([
      { teacherId: "T2", teacherName: "Teacher Two", completed: 0, scheduled: 1, rate: 0 },
      { teacherId: "T1", teacherName: "Teacher One", completed: 2, scheduled: 3, rate: 2 / 3 },
    ]);
  });

  it("throws when the bookings query errors", async () => {
    chain.returns.mockResolvedValueOnce({ data: null, error: { message: "db fail" } });
    await expect(getTeacherCompletionRates(chain as never, NOW)).rejects.toThrow("db fail");
  });
});
