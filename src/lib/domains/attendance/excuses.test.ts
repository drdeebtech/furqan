import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase.generated";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/settings", () => ({
  getSettings: vi.fn().mockResolvedValue({ excuse_notice_threshold_seconds: "7200" }),
}));

import {
  submitExcuse,
  decideExcuse,
  ExcuseAuthorizationError,
  ExcuseAlreadyDecidedError,
  ExcuseNotEligibleError,
} from "./excuses";

// Mock finalizeAttendance so we don't need the RPC; verify it's called on accept.
vi.mock("./finalize", () => ({
  finalizeAttendance: vi.fn().mockResolvedValue(undefined),
}));

describe("submitExcuse — eligibility threshold", () => {
  const mockSupabase = {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn(),
    insert: vi.fn().mockReturnThis(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks eligible when submitted >= threshold before session start", async () => {
    const futureScheduledAt = new Date(Date.now() + 3 * 3600 * 1000).toISOString(); // 3h out
    mockSupabase.single.mockResolvedValueOnce({
      data: {
        student_id: "student-1",
        teacher_id: "teacher-1",
        scheduled_at: futureScheduledAt,
      },
      error: null,
    });
    mockSupabase.single.mockResolvedValueOnce({
      data: { id: "excuse-1", is_eligible: true },
      error: null,
    });

    const result = await submitExcuse(mockSupabase as unknown as SupabaseClient<Database>, {
      bookingId: "booking-1",
      reason: "family emergency",
      userId: "student-1",
    });
    expect(result.isEligible).toBe(true);
  });

  it("marks ineligible when submitted inside threshold", async () => {
    const soonScheduledAt = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30min out
    mockSupabase.single.mockResolvedValueOnce({
      data: {
        student_id: "student-1",
        teacher_id: "teacher-1",
        scheduled_at: soonScheduledAt,
      },
      error: null,
    });
    mockSupabase.single.mockResolvedValueOnce({
      data: { id: "excuse-2", is_eligible: false },
      error: null,
    });

    const result = await submitExcuse(mockSupabase as unknown as SupabaseClient<Database>, {
      bookingId: "booking-1",
      reason: "running late",
      userId: "student-1",
    });
    expect(result.isEligible).toBe(false);
  });

  it("rejects submit when student_id does not match caller", async () => {
    mockSupabase.single.mockResolvedValueOnce({
      data: { student_id: "other-student", teacher_id: "teacher-1", scheduled_at: "2026-07-01" },
      error: null,
    });
    await expect(
      submitExcuse(mockSupabase as unknown as SupabaseClient<Database>, {
        bookingId: "booking-1",
        reason: "test",
        userId: "student-1",
      }),
    ).rejects.toThrow(/Not your booking/);
  });
});

describe("decideExcuse — authorization + eligibility gating", () => {
  // Thenable chainable mock. Builder resolves to queued value when awaited
  // (covers update().eq() which is awaited directly); .single() also resolves.
  const makeMockAdmin = () => {
    const queue: Array<{ data?: unknown; error?: unknown }> = [];
    const builder = {
      from: vi.fn(() => builder),
      select: vi.fn(() => builder),
      update: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      single: vi.fn(async () => queue.shift() ?? { data: null, error: null }),
      then: (resolve: (v: { data?: unknown; error?: unknown }) => void) =>
        Promise.resolve(queue.shift() ?? { error: null }).then(resolve),
      _queue: (r: { data?: unknown; error?: unknown }) => queue.push(r),
    };
    return builder;
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws ExcuseAuthorizationError when non-admin non-teacher decides", async () => {
    const admin = makeMockAdmin();
    admin._queue({
      data: { id: "e1", booking_id: "b1", teacher_id: "teacher-A", is_eligible: true, status: "pending" },
      error: null,
    });
    await expect(
      decideExcuse(admin as unknown as SupabaseClient<Database>, {
        excuseId: "e1",
        decision: "accepted",
        deciderId: "teacher-B",
        isAdmin: false,
      }),
    ).rejects.toThrow(ExcuseAuthorizationError);
  });

  it("throws ExcuseAlreadyDecidedError when status is not pending", async () => {
    const admin = makeMockAdmin();
    admin._queue({
      data: { id: "e1", booking_id: "b1", teacher_id: "teacher-A", is_eligible: true, status: "accepted" },
      error: null,
    });
    await expect(
      decideExcuse(admin as unknown as SupabaseClient<Database>, {
        excuseId: "e1",
        decision: "rejected",
        deciderId: "teacher-A",
        isAdmin: false,
      }),
    ).rejects.toThrow(ExcuseAlreadyDecidedError);
  });

  it("throws ExcuseNotEligibleError when accepting an ineligible excuse", async () => {
    const admin = makeMockAdmin();
    admin._queue({
      data: { id: "e1", booking_id: "b1", teacher_id: "teacher-A", is_eligible: false, status: "pending" },
      error: null,
    });
    await expect(
      decideExcuse(admin as unknown as SupabaseClient<Database>, {
        excuseId: "e1",
        decision: "accepted",
        deciderId: "teacher-A",
        isAdmin: false,
      }),
    ).rejects.toThrow(ExcuseNotEligibleError);
  });

  it("accept path triggers finalizeAttendance (carry-over)", async () => {
    const { finalizeAttendance } = await import("./finalize");
    (finalizeAttendance as ReturnType<typeof vi.fn>).mockClear();
    const admin = makeMockAdmin();
    admin._queue({
      data: { id: "e1", booking_id: "b1", teacher_id: "teacher-A", is_eligible: true, status: "pending" },
      error: null,
    });
    admin._queue({ error: null }); // update().eq() resolve

    const result = await decideExcuse(admin as unknown as SupabaseClient<Database>, {
      excuseId: "e1",
      decision: "accepted",
      deciderId: "teacher-A",
      isAdmin: false,
    });
    expect(result.carried).toBe(true);
    expect(finalizeAttendance).toHaveBeenCalledWith(expect.anything(), "b1", "excused_carried");
  });

  it("reject path does NOT trigger finalizeAttendance", async () => {
    const { finalizeAttendance } = await import("./finalize");
    (finalizeAttendance as ReturnType<typeof vi.fn>).mockClear();
    const admin = makeMockAdmin();
    admin._queue({
      data: { id: "e2", booking_id: "b2", teacher_id: "teacher-A", is_eligible: true, status: "pending" },
      error: null,
    });
    admin._queue({ error: null });

    const result = await decideExcuse(admin as unknown as SupabaseClient<Database>, {
      excuseId: "e2",
      decision: "rejected",
      deciderId: "teacher-A",
      isAdmin: false,
    });
    expect(result.carried).toBe(false);
    expect(finalizeAttendance).not.toHaveBeenCalled();
  });
});
