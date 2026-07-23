import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const chain = vi.hoisted(() => ({
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  gte: vi.fn().mockReturnThis(),
  lt: vi.fn().mockReturnThis(),
  not: vi.fn().mockReturnThis(),
  is: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  returns: vi.fn(),
}));

import {
  getAdminMonthlyRevenueTrend,
  getAdminDailyRevenue,
  getPlatformLiveSessions,
  getAdminBookingStatusBreakdown,
  getAdminRecentBookings,
} from "./admin-dashboard";
import { formatDate } from "@/lib/i18n/format-date";

beforeEach(() => {
  vi.clearAllMocks();
  chain.from.mockReturnThis();
  chain.select.mockReturnThis();
  chain.eq.mockReturnThis();
  chain.gte.mockReturnThis();
  chain.lt.mockReturnThis();
  chain.not.mockReturnThis();
  chain.is.mockReturnThis();
  chain.order.mockReturnThis();
  chain.limit.mockReturnThis();
});

describe("getAdminMonthlyRevenueTrend", () => {
  it("sums current vs previous month and computes changePct", async () => {
    chain.returns
      .mockResolvedValueOnce({ data: [{ amount_usd: 100 }, { amount_usd: 50 }], error: null }) // current
      .mockResolvedValueOnce({ data: [{ amount_usd: 100 }], error: null }); // previous

    const result = await getAdminMonthlyRevenueTrend(chain as never);

    expect(result).toEqual({ currentMonthUsd: 150, previousMonthUsd: 100, changePct: 50 });

    expect(chain.from).toHaveBeenCalledWith("bookings");
    expect(chain.eq).toHaveBeenCalledWith("status", "completed");
    expect(chain.gte).toHaveBeenCalledTimes(2);
    expect(chain.lt).toHaveBeenCalledWith("created_at", expect.any(String));
  });

  it("clamps changePct to 100 when there was no revenue last month but there is this month", async () => {
    chain.returns
      .mockResolvedValueOnce({ data: [{ amount_usd: 50 }], error: null }) // current
      .mockResolvedValueOnce({ data: [], error: null }); // previous

    const result = await getAdminMonthlyRevenueTrend(chain as never);

    expect(result).toEqual({ currentMonthUsd: 50, previousMonthUsd: 0, changePct: 100 });
  });

  it("reports changePct=0 and treats missing/null query data and falsy amounts as zero revenue", async () => {
    chain.returns
      .mockResolvedValueOnce({ data: null, error: { message: "db down" } }) // current
      .mockResolvedValueOnce({ data: [{ amount_usd: 0 }], error: null }); // previous

    const result = await getAdminMonthlyRevenueTrend(chain as never);

    expect(result).toEqual({ currentMonthUsd: 0, previousMonthUsd: 0, changePct: 0 });
  });
});

describe("getAdminDailyRevenue", () => {
  it("buckets completed bookings by weekday and flags the busiest day active", async () => {
    // 2026-06-15 is a Monday, 2026-06-16 a Tuesday (verified against EN_DAYS/getDay()).
    chain.returns.mockResolvedValueOnce({
      data: [
        { amount_usd: 100, created_at: "2026-06-15T10:00:00.000Z" },
        { amount_usd: 50, created_at: "2026-06-15T14:00:00.000Z" },
        { amount_usd: 30, created_at: "2026-06-16T10:00:00.000Z" },
      ],
      error: null,
    });

    const result = await getAdminDailyRevenue(chain as never, "en");

    expect(result).toEqual([
      { day: "Mon", value: 150, isActive: true },
      { day: "Tues", value: 30, isActive: false },
      { day: "Wed", value: 0, isActive: false },
      { day: "Thurs", value: 0, isActive: false },
      { day: "Fri", value: 0, isActive: false },
      { day: "Sat", value: 0, isActive: false },
      { day: "Sun", value: 0, isActive: false },
    ]);

    expect(chain.from).toHaveBeenCalledWith("bookings");
    expect(chain.eq).toHaveBeenCalledWith("status", "completed");
    expect(chain.gte).toHaveBeenCalledWith("created_at", expect.any(String));
  });

  it("returns an empty week and does not throw when the query errors", async () => {
    chain.returns.mockResolvedValueOnce({ data: null, error: { message: "db down" } });

    const result = await getAdminDailyRevenue(chain as never, "en");

    expect(result).toEqual([
      { day: "Mon", value: 0, isActive: false },
      { day: "Tues", value: 0, isActive: false },
      { day: "Wed", value: 0, isActive: false },
      { day: "Thurs", value: 0, isActive: false },
      { day: "Fri", value: 0, isActive: false },
      { day: "Sat", value: 0, isActive: false },
      { day: "Sun", value: 0, isActive: false },
    ]);
  });

  it("returns an empty week for zero completed bookings", async () => {
    chain.returns.mockResolvedValueOnce({ data: [], error: null });

    const result = await getAdminDailyRevenue(chain as never, "en");

    expect(result[0]).toEqual({ day: "Mon", value: 0, isActive: false });
  });

  it("buckets by weekday with Arabic day labels", async () => {
    chain.returns.mockResolvedValueOnce({
      data: [{ amount_usd: 40, created_at: "2026-06-15T10:00:00.000Z" }], // Monday
      error: null,
    });

    const result = await getAdminDailyRevenue(chain as never, "ar");

    expect(result[0]).toEqual({ day: "إثنين", value: 40, isActive: true });
  });
});

describe("getPlatformLiveSessions", () => {
  afterEach(() => vi.useRealTimers());

  it("maps a started, not-yet-ended session into a live-session item", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00.000Z"));

    chain.returns.mockResolvedValueOnce({
      data: [
        {
          id: "sess-1",
          started_at: "2026-06-15T11:00:00.000Z",
          booking: {
            session_type: "hifz",
            student: { full_name: "Student One" },
            teacher: { full_name: "Teacher One" },
          },
        },
      ],
      error: null,
    });

    const result = await getPlatformLiveSessions(chain as never);

    expect(result).toEqual([
      {
        id: "sess-1",
        title: "Student One ← Teacher One",
        subtitle: "hifz",
        initials: "Te",
        timeRemaining: "01:00:00",
        progressPercent: undefined,
      },
    ]);

    expect(chain.from).toHaveBeenCalledWith("sessions");
    expect(chain.not).toHaveBeenCalledWith("started_at", "is", null);
    expect(chain.is).toHaveBeenCalledWith("ended_at", null);
    expect(chain.gte).toHaveBeenCalledWith("started_at", expect.any(String));
  });

  it("returns [] when the sessions query errors", async () => {
    chain.returns.mockResolvedValueOnce({ data: null, error: { message: "db down" } });

    const result = await getPlatformLiveSessions(chain as never);

    expect(result).toEqual([]);
  });

  it("returns [] when there are no live sessions", async () => {
    chain.returns.mockResolvedValueOnce({ data: [], error: null });

    const result = await getPlatformLiveSessions(chain as never);

    expect(result).toEqual([]);
  });

  it("falls back to em-dash placeholders when booking/student/teacher/session_type are missing", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00.000Z"));

    chain.returns.mockResolvedValueOnce({
      data: [
        {
          id: "sess-2",
          started_at: "2026-06-15T11:30:00.000Z",
          booking: null,
        },
      ],
      error: null,
    });

    const result = await getPlatformLiveSessions(chain as never);

    expect(result).toEqual([
      {
        id: "sess-2",
        title: "— ← —",
        subtitle: "session",
        initials: "—",
        timeRemaining: "00:30:00",
        progressPercent: undefined,
      },
    ]);
  });
});

describe("getAdminBookingStatusBreakdown", () => {
  it("counts bookings by status, sorted highest-first, with EN labels", async () => {
    chain.returns.mockResolvedValueOnce({
      data: [
        { status: "completed" },
        { status: "completed" },
        { status: "completed" },
        { status: "pending" },
      ],
      error: null,
    });

    const result = await getAdminBookingStatusBreakdown(chain as never, "en");

    expect(result).toEqual([
      { label: "Completed", value: 3, color: "#22C55E" },
      { label: "Pending", value: 1, color: "#F59E0B" },
    ]);

    expect(chain.from).toHaveBeenCalledWith("bookings");
    expect(chain.gte).toHaveBeenCalledWith("created_at", expect.any(String));
  });

  it("returns [] when the query errors", async () => {
    chain.returns.mockResolvedValueOnce({ data: null, error: { message: "db down" } });

    const result = await getAdminBookingStatusBreakdown(chain as never, "en");

    expect(result).toEqual([]);
  });

  it("returns [] for an empty result set", async () => {
    chain.returns.mockResolvedValueOnce({ data: [], error: null });

    const result = await getAdminBookingStatusBreakdown(chain as never, "en");

    expect(result).toEqual([]);
  });

  it("falls back to the raw status string and gray color for an unrecognized status", async () => {
    chain.returns.mockResolvedValueOnce({
      data: [{ status: "weird_status" }],
      error: null,
    });

    const result = await getAdminBookingStatusBreakdown(chain as never, "en");

    expect(result).toEqual([{ label: "weird_status", value: 1, color: "#9CA3AF" }]);
  });

  it("uses Arabic labels when lang=ar", async () => {
    chain.returns.mockResolvedValueOnce({
      data: [{ status: "completed" }],
      error: null,
    });

    const result = await getAdminBookingStatusBreakdown(chain as never, "ar");

    expect(result).toEqual([{ label: "مكتمل", value: 1, color: "#22C55E" }]);
  });
});

describe("getAdminRecentBookings", () => {
  it("maps recent bookings with progress derived from status", async () => {
    const createdAt = "2026-06-15T10:00:00.000Z";
    chain.returns.mockResolvedValueOnce({
      data: [
        {
          id: "abcdef12-0000-0000-0000-000000000000",
          session_type: "hifz",
          amount_usd: 20,
          status: "confirmed",
          created_at: createdAt,
          student: { full_name: "Student One" },
        },
      ],
      error: null,
    });

    const result = await getAdminRecentBookings(chain as never, 6, "en");

    expect(result).toEqual([
      {
        id: "ABCDEF",
        subject: "hifz",
        date: formatDate(createdAt, "en"),
        progress: 60,
        assignee: "Student One",
        view: "view",
      },
    ]);

    expect(chain.from).toHaveBeenCalledWith("bookings");
    expect(chain.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(chain.limit).toHaveBeenCalledWith(6);
  });

  it("returns [] when the query errors", async () => {
    chain.returns.mockResolvedValueOnce({ data: null, error: { message: "db down" } });

    const result = await getAdminRecentBookings(chain as never, 6, "en");

    expect(result).toEqual([]);
  });

  it("returns [] for an empty result set", async () => {
    chain.returns.mockResolvedValueOnce({ data: [], error: null });

    const result = await getAdminRecentBookings(chain as never, 6, "en");

    expect(result).toEqual([]);
  });

  it("maps completed/pending/unrecognized statuses to their progress percentages and falls back to em-dash for missing fields", async () => {
    const createdAt = "2026-06-15T10:00:00.000Z";
    chain.returns.mockResolvedValueOnce({
      data: [
        {
          id: "aaaaaaaa-0000-0000-0000-000000000000",
          session_type: null,
          amount_usd: 10,
          status: "completed",
          created_at: createdAt,
          student: null,
        },
        {
          id: "bbbbbbbb-0000-0000-0000-000000000000",
          session_type: "hifz",
          amount_usd: 10,
          status: "pending",
          created_at: createdAt,
          student: { full_name: "Student Two" },
        },
        {
          id: "cccccccc-0000-0000-0000-000000000000",
          session_type: "hifz",
          amount_usd: 10,
          status: "no_show",
          created_at: createdAt,
          student: { full_name: "Student Three" },
        },
      ],
      error: null,
    });

    const result = await getAdminRecentBookings(chain as never, 6, "en");

    expect(result).toEqual([
      {
        id: "AAAAAA",
        subject: "—",
        date: formatDate(createdAt, "en"),
        progress: 100,
        assignee: "—",
        view: "view",
      },
      {
        id: "BBBBBB",
        subject: "hifz",
        date: formatDate(createdAt, "en"),
        progress: 30,
        assignee: "Student Two",
        view: "view",
      },
      {
        id: "CCCCCC",
        subject: "hifz",
        date: formatDate(createdAt, "en"),
        progress: 0,
        assignee: "Student Three",
        view: "view",
      },
    ]);
  });
});
