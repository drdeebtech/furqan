import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const chain = vi.hoisted(() => ({
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  lt: vi.fn().mockReturnThis(),
  gte: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  returns: vi.fn(),
}));

import { getTalqeenQueueForTeacher } from "./teacher-talqeen";

const TEACHER = "teacher-aaa";

beforeEach(() => {
  vi.clearAllMocks();
  chain.from.mockReturnThis();
  chain.select.mockReturnThis();
  chain.eq.mockReturnThis();
  chain.in.mockReturnThis();
  chain.lt.mockReturnThis();
  chain.gte.mockReturnThis();
  chain.order.mockReturnThis();
  chain.limit.mockReturnThis();
});

describe("getTalqeenQueueForTeacher", () => {
  it("resolves student names, computes hoursSinceReady, and hoists streak-break-risk rows to the top", async () => {
    const now = Date.now();
    const stale = new Date(now - 60 * 60 * 60 * 1000).toISOString(); // 60h ago > 48h risk threshold
    const fresh = new Date(now - 2 * 60 * 60 * 1000).toISOString(); // 2h ago
    chain.returns
      .mockResolvedValueOnce({
        data: [
          {
            id: "h1",
            title: "Al-Fatiha",
            student_id: "s1",
            audio_duration_seconds: 42,
            ready_at: fresh,
            surah_number: 1,
            ayah_start: 1,
            ayah_end: 7,
          },
          {
            id: "h2",
            title: "Al-Baqarah",
            student_id: "s2",
            audio_duration_seconds: null,
            ready_at: stale,
            surah_number: 2,
            ayah_start: 1,
            ayah_end: 5,
          },
        ],
        error: null,
      })
      .mockResolvedValueOnce({ data: [{ id: "s1", full_name: "Aisha" }], error: null }); // s2 missing → "—"

    const rows = await getTalqeenQueueForTeacher(chain as never, TEACHER, "all");

    expect(rows).toHaveLength(2);
    // Risk row (h2) hoisted above the non-risk row (h1) despite arriving second.
    expect(rows[0].id).toBe("h2");
    expect(rows[0].studentName).toBe("—");
    expect(rows[0].streakBreakRisk).toBe(true);
    expect(rows[1].id).toBe("h1");
    expect(rows[1].studentName).toBe("Aisha");
    expect(rows[1].streakBreakRisk).toBe(false);
  });

  it("returns [] without a name-resolve query when the queue is empty", async () => {
    chain.returns.mockResolvedValueOnce({ data: [], error: null });
    const rows = await getTalqeenQueueForTeacher(chain as never, TEACHER, "all");
    expect(rows).toEqual([]);
    expect(chain.returns).toHaveBeenCalledTimes(1);
  });

  it("throws when the inbox query errors", async () => {
    chain.returns.mockResolvedValueOnce({ data: null, error: new Error("db fail") });
    await expect(getTalqeenQueueForTeacher(chain as never, TEACHER, "all")).rejects.toThrow(
      "db fail",
    );
  });

  it("applies the 'today' filter as a 24h gte cutoff", async () => {
    chain.returns.mockResolvedValueOnce({ data: [], error: null });
    await getTalqeenQueueForTeacher(chain as never, TEACHER, "today");
    expect(chain.gte).toHaveBeenCalledWith("ready_at", expect.any(String));
  });

  it("applies the 'overdue' filter as an lt cutoff on the streak-break-risk threshold", async () => {
    chain.returns.mockResolvedValueOnce({ data: [], error: null });
    await getTalqeenQueueForTeacher(chain as never, TEACHER, "overdue");
    expect(chain.lt).toHaveBeenCalledWith("ready_at", expect.any(String));
  });
});
