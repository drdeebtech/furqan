import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const chain = vi.hoisted(() => ({
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  rpc: vi.fn().mockReturnThis(),
  returns: vi.fn(),
}));

import { getTeacherRecitationRoster } from "./teacher-recitations";

const TEACHER = "teacher-aaa";

beforeEach(() => {
  vi.clearAllMocks();
  chain.from.mockReturnThis();
  chain.select.mockReturnThis();
  chain.in.mockReturnThis();
  chain.rpc.mockReturnThis();
});

describe("getTeacherRecitationRoster", () => {
  it("joins profiles + last-5 progress per student and flags streak-break risk", async () => {
    const now = Date.now();
    const recentIso = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(); // 2 days ago
    chain.returns
      .mockResolvedValueOnce({ data: [{ student_id: "s1" }, { student_id: "s2" }], error: null }) // distinct students RPC
      .mockResolvedValueOnce({
        data: [
          { id: "s1", full_name: "Aisha", avatar_url: "http://a/1.png" },
          { id: "s2", full_name: null, avatar_url: null },
        ],
        error: null,
      }) // profiles
      .mockResolvedValueOnce({
        data: [
          {
            student_id: "s1",
            surah_from: 1,
            surah_to: 2,
            quality_rating: 4,
            created_at: recentIso,
          },
        ],
        error: null,
      }); // roster_recent_progress RPC — s2 has no rows (never recorded)

    const rows = await getTeacherRecitationRoster(chain as never, TEACHER);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      studentId: "s1",
      studentName: "Aisha",
      avatarUrl: "http://a/1.png",
      currentSurah: 2,
      qualityAvgLast5: 4,
      streakBreakRisk: false,
    });
    // s2: never recorded → worst case, "—" name fallback, risk true
    expect(rows[1]).toMatchObject({
      studentId: "s2",
      studentName: "—",
      lastHeardAt: null,
      daysSinceLastHeard: null,
      streakBreakRisk: true,
    });
  });

  it("averages quality_rating across multiple progress rows for a student", async () => {
    const now = Date.now();
    const isoDaysAgo = (d: number) => new Date(now - d * 24 * 60 * 60 * 1000).toISOString();
    chain.returns
      .mockResolvedValueOnce({ data: [{ student_id: "s1" }], error: null }) // distinct students RPC
      .mockResolvedValueOnce({
        data: [{ id: "s1", full_name: "Aisha", avatar_url: null }],
        error: null,
      }) // profiles
      .mockResolvedValueOnce({
        data: [
          { student_id: "s1", surah_from: 1, surah_to: 2, quality_rating: 4, created_at: isoDaysAgo(1) },
          { student_id: "s1", surah_from: 1, surah_to: 2, quality_rating: 5, created_at: isoDaysAgo(2) },
          { student_id: "s1", surah_from: 1, surah_to: 2, quality_rating: 3, created_at: isoDaysAgo(3) },
        ],
        error: null,
      }); // roster_recent_progress RPC — three rows for s1

    const rows = await getTeacherRecitationRoster(chain as never, TEACHER);

    expect(rows).toHaveLength(1);
    expect(rows[0].qualityAvgLast5).toBe(4); // (4 + 5 + 3) / 3
  });

  it("returns [] without further queries when the teacher has no students", async () => {
    chain.returns.mockResolvedValueOnce({ data: [], error: null });
    const rows = await getTeacherRecitationRoster(chain as never, TEACHER);
    expect(rows).toEqual([]);
    expect(chain.returns).toHaveBeenCalledTimes(1);
  });

  it("throws when the distinct-students RPC errors", async () => {
    chain.returns.mockResolvedValueOnce({ data: null, error: { message: "rpc fail" } });
    await expect(getTeacherRecitationRoster(chain as never, TEACHER)).rejects.toThrow("rpc fail");
  });
});
