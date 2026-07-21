import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase.generated";

vi.mock("server-only", () => ({}));

import { finalizeAttendance, computeEffectiveEndDate, BookingNotFoundError } from "./finalize";

describe("finalizeAttendance", () => {
  const mockAdmin = {
    rpc: vi.fn(),
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns void on success (RPC returns no error)", async () => {
    mockAdmin.rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(
      finalizeAttendance(
        mockAdmin as unknown as SupabaseClient<Database>,
        "booking-1",
        "student_absent",
      ),
    ).resolves.toBeUndefined();
    expect(mockAdmin.rpc).toHaveBeenCalledWith("finalize_attendance", {
      p_booking_id: "booking-1",
      p_outcome: "student_absent",
      p_actual_teacher_id: undefined,
    });
  });

  it("throws BookingNotFoundError on P0002", async () => {
    mockAdmin.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "P0002", message: "no_data_found" },
    });
    await expect(
      finalizeAttendance(
        mockAdmin as unknown as SupabaseClient<Database>,
        "missing-booking",
        "present",
      ),
    ).rejects.toThrow(BookingNotFoundError);
  });

  it("throws FinalizeAttendanceError on other DB errors (preserves code)", async () => {
    mockAdmin.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "55000", message: "function crashed" },
    });
    await expect(
      finalizeAttendance(
        mockAdmin as unknown as SupabaseClient<Database>,
        "booking-1",
        "present",
      ),
    ).rejects.toMatchObject({ name: "FinalizeAttendanceError", code: "55000" });
  });

  it("passes actualTeacherId through when provided (substitute case)", async () => {
    mockAdmin.rpc.mockResolvedValueOnce({ data: null, error: null });
    await finalizeAttendance(
      mockAdmin as unknown as SupabaseClient<Database>,
      "booking-1",
      "teacher_absent",
      "substitute-teacher-id",
    );
    expect(mockAdmin.rpc).toHaveBeenCalledWith("finalize_attendance", {
      p_booking_id: "booking-1",
      p_outcome: "teacher_absent",
      p_actual_teacher_id: "substitute-teacher-id",
    });
  });
});

describe("computeEffectiveEndDate", () => {
  // Thenable chainable mock. The builder resolves to the queued {data,error}
  // when awaited directly (no .single()), and .single() also resolves it.
  const makeMockAdmin = () => {
    const queue: Array<{ data: unknown; error: unknown }> = [];
    const builder = {
      from: vi.fn(() => builder),
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      single: vi.fn(async () => queue.shift() ?? { data: null, error: null }),
      then: (resolve: (v: { data: unknown; error: unknown }) => void) =>
        Promise.resolve(queue.shift() ?? { data: null, error: null }).then(resolve),
      _queue: (r: { data: unknown; error: unknown }) => queue.push(r),
    };
    return builder;
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when subscription has no current_period_end", async () => {
    const admin = makeMockAdmin();
    admin._queue({ data: { current_period_end: null }, error: null });
    const result = await computeEffectiveEndDate(
      admin as unknown as SupabaseClient<Database>,
      "sub-1",
    );
    expect(result).toBeNull();
  });

  it("returns base period_end when no extensions exist (COALESCE guard)", async () => {
    const admin = makeMockAdmin();
    admin._queue({ data: { current_period_end: "2026-07-01T00:00:00Z" }, error: null });
    admin._queue({ data: [], error: null });
    const result = await computeEffectiveEndDate(
      admin as unknown as SupabaseClient<Database>,
      "sub-1",
    );
    expect(result).toBe("2026-07-01T00:00:00.000Z");
  });

  it("adds SUM(extension_seconds) to base period_end", async () => {
    const admin = makeMockAdmin();
    admin._queue({ data: { current_period_end: "2026-07-01T00:00:00Z" }, error: null });
    admin._queue({
      data: [{ extension_seconds: 3600 }, { extension_seconds: 1800 }],
      error: null,
    });
    const result = await computeEffectiveEndDate(
      admin as unknown as SupabaseClient<Database>,
      "sub-1",
    );
    expect(result).toBe("2026-07-01T01:30:00.000Z");
  });
});
