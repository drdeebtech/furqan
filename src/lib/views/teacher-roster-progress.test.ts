import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const chain = vi.hoisted(() => ({
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  rpc: vi.fn().mockReturnThis(),
  returns: vi.fn(),
}));

import { getTeacherRosterProgress, avgOf } from "./teacher-roster-progress";

const TEACHER = "teacher-aaa";

beforeEach(() => {
  vi.clearAllMocks();
  chain.from.mockReturnThis();
  chain.select.mockReturnThis();
  chain.in.mockReturnThis();
  chain.rpc.mockReturnThis();
});

describe("avgOf", () => {
  it("averages numbers and ignores nulls", () => {
    expect(avgOf([3, null, 5])).toBe(4);
  });
  it("returns null when every value is null", () => {
    expect(avgOf([null, null])).toBeNull();
  });
  it("returns null for an empty array", () => {
    expect(avgOf([])).toBeNull();
  });
});

describe("getTeacherRosterProgress", () => {
  it("computes per-student averages, the weighted composite, eval lag, and at-risk flag", async () => {
    const now = Date.now();
    const recentIso = new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString(); // 5 days ago, not lagging
    chain.returns
      .mockResolvedValueOnce({ data: [{ student_id: "s1" }, { student_id: "s2" }], error: null }) // distinct students
      .mockResolvedValueOnce({
        data: [
          { id: "s1", full_name: "Aisha" },
          { id: "s2", full_name: null },
        ],
        error: null,
      }) // profiles
      .mockResolvedValueOnce({
        data: [
          {
            student_id: "s1",
            evaluation_date: recentIso,
            hifz_score: 4,
            tajweed_score: 4,
            fluency_score: 4,
            attendance_score: 5,
            overall_score: 4,
          },
        ],
        error: null,
      }); // evals RPC — s2 has zero evals (never evaluated)

    const rows = await getTeacherRosterProgress(chain as never, TEACHER);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      studentId: "s1",
      studentName: "Aisha",
      hifzAvg: 4,
      composite: 4,
      evalCount: 1,
      atRisk: false,
    });
    // Never-evaluated student: worst case → atRisk true, "—" fallback name.
    expect(rows[1]).toMatchObject({
      studentId: "s2",
      studentName: "—",
      evalCount: 0,
      daysSinceLastEval: null,
      atRisk: true,
    });
  });

  it("returns [] without further queries when the teacher has no students", async () => {
    chain.returns.mockResolvedValueOnce({ data: [], error: null });
    const rows = await getTeacherRosterProgress(chain as never, TEACHER);
    expect(rows).toEqual([]);
    expect(chain.returns).toHaveBeenCalledTimes(1);
  });

  it("throws when the distinct-students RPC errors", async () => {
    chain.returns.mockResolvedValueOnce({ data: null, error: { message: "rpc fail" } });
    await expect(getTeacherRosterProgress(chain as never, TEACHER)).rejects.toThrow("rpc fail");
  });
});
