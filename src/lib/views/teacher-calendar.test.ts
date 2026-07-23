import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const chain = vi.hoisted(() => ({
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  gte: vi.fn().mockReturnThis(),
  lte: vi.fn().mockReturnThis(),
  returns: vi.fn(),
}));

import { getTeacherCalendarEvents } from "./teacher-calendar";

const TEACHER = "teacher-aaa";
const MONTH_START = new Date("2026-06-01T00:00:00.000Z");
const MONTH_END = new Date("2026-06-30T23:59:59.999Z");

beforeEach(() => {
  vi.clearAllMocks();
  chain.from.mockReturnThis();
  chain.select.mockReturnThis();
  chain.eq.mockReturnThis();
  chain.in.mockReturnThis();
  chain.gte.mockReturnThis();
  chain.lte.mockReturnThis();
});

describe("getTeacherCalendarEvents", () => {
  it("merges bookings + halaqas, sorts bookings-first on tied isoStart, and rolls up weekly availability", async () => {
    // Query order: bookings, teacher_availability, session_participants (Promise.all), then sessions (halaqas)
    chain.returns
      .mockResolvedValueOnce({
        data: [
          { id: "b1", scheduled_at: "2026-06-10T10:00:00.000Z", session_type: "hifz", status: "confirmed" },
          { id: "b2", scheduled_at: "2026-06-12T10:00:00.000Z", session_type: "tajweed", status: "no_show" },
        ],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ id: "av1", day_of_week: 1, start_time: "14:00", end_time: "15:30", is_active: true }],
        error: null,
      })
      .mockResolvedValueOnce({ data: [{ session_id: "sess1" }], error: null })
      .mockResolvedValueOnce({
        data: [
          {
            id: "sess1",
            scheduled_at: "2026-06-10T10:00:00.000Z",
            session_topic_ar: null,
            session_topic_en: "Surah Al-Mulk",
            session_mode: "halaqa",
          },
        ],
        error: null,
      });

    const payload = await getTeacherCalendarEvents(chain as never, TEACHER, MONTH_START, MONTH_END);

    expect(payload.events).toHaveLength(3);
    // Same isoStart (b1 and the halaqa) → booking sorts before halaqa.
    expect(payload.events[0]).toMatchObject({ id: "booking_b1", kind: "booking" });
    expect(payload.events[1]).toMatchObject({ id: "halaqa_sess1", kind: "halaqa" });
    expect(payload.events[2]).toMatchObject({ id: "booking_b2", kind: "booking", color: "#EF4444" });
    expect(payload.weeklyAvailability).toEqual([{ dayOfWeek: 1, totalMinutes: 90 }]);
  });

  it("skips the halaqa fetch and returns no weekly-availability rows when there are none", async () => {
    chain.returns
      .mockResolvedValueOnce({ data: [], error: null }) // bookings
      .mockResolvedValueOnce({ data: [], error: null }) // availability
      .mockResolvedValueOnce({ data: [], error: null }); // session_participants → no halaqa ids

    const payload = await getTeacherCalendarEvents(chain as never, TEACHER, MONTH_START, MONTH_END);
    expect(payload.events).toEqual([]);
    expect(payload.weeklyAvailability).toEqual([]);
    expect(chain.returns).toHaveBeenCalledTimes(3); // no 4th halaqas query
  });

  it("throws when the bookings query errors", async () => {
    chain.returns
      .mockResolvedValueOnce({ data: null, error: new Error("db fail") })
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [], error: null });
    await expect(
      getTeacherCalendarEvents(chain as never, TEACHER, MONTH_START, MONTH_END),
    ).rejects.toThrow("db fail");
  });
});
