import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase.generated";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/automation/emit", () => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
}));

import { createConstrainedBooking, TeacherMismatchError, SlotAlreadyBookedError, AssignmentNotFoundError } from "./bookings";
import * as assignments from "./assignments";
import * as availability from "./availability";

vi.mock("./assignments");
vi.mock("./availability");

describe("createConstrainedBooking", () => {
  // Mocks imitate a chainable Supabase query builder. The literal is inferred
  // (so individual mock methods stay directly callable); cast to
  // `SupabaseClient<Database>` only when passed into the function under test.
  // No `as any` — the literal's vi.fn shape is its own structural type.
  const mockSupabase = {
    from: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn(),
  };

  const mockAdmin = {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn(),
  };

  const userId = "student-123";
  const slotInstanceId = "slot-456";
  const teacherId = "teacher-789";
  const scheduledAt = "2026-07-01T10:00:00Z";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should create a booking when teacher matches assignment", async () => {
    vi.spyOn(assignments, "getMyAssignment").mockResolvedValue({
      teacher_id: teacherId,
    } as never);

    mockAdmin.single.mockResolvedValueOnce({
      data: { teacher_id: teacherId, is_booked: false },
      error: null,
    });

    vi.spyOn(availability, "lockSlot").mockResolvedValue(true);

    mockSupabase.single.mockResolvedValueOnce({
      data: { id: "booking-001" },
      error: null,
    });

    const result = await createConstrainedBooking(
      mockSupabase as unknown as SupabaseClient<Database>,
      mockAdmin as unknown as SupabaseClient<Database>,
      userId,
      slotInstanceId,
      scheduledAt,
    );

    expect(result).toBe("booking-001");
    expect(mockSupabase.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        student_id: userId,
        teacher_id: teacherId,
        scheduled_at: scheduledAt,
        status: "pending",
        amount_usd: 0,
        duration_min: 60,
        rate_snapshot: 0,
      }),
    );
  });

  it("should throw AssignmentNotFoundError when no assignment exists", async () => {
    vi.spyOn(assignments, "getMyAssignment").mockResolvedValue(null);

    await expect(
      createConstrainedBooking(
        mockSupabase as unknown as SupabaseClient<Database>,
        mockAdmin as unknown as SupabaseClient<Database>,
        userId,
        slotInstanceId,
        scheduledAt,
      ),
    ).rejects.toThrow(AssignmentNotFoundError);
  });

  it("should throw TeacherMismatchError when teacher does not match", async () => {
    vi.spyOn(assignments, "getMyAssignment").mockResolvedValue({
      teacher_id: teacherId,
    } as never);

    mockAdmin.single.mockResolvedValueOnce({
      data: { teacher_id: "other-teacher", is_booked: false },
      error: null,
    });

    await expect(
      createConstrainedBooking(
        mockSupabase as unknown as SupabaseClient<Database>,
        mockAdmin as unknown as SupabaseClient<Database>,
        userId,
        slotInstanceId,
        scheduledAt,
      ),
    ).rejects.toThrow(TeacherMismatchError);
  });

  it("should throw SlotAlreadyBookedError when slot is already booked", async () => {
    vi.spyOn(assignments, "getMyAssignment").mockResolvedValue({
      teacher_id: teacherId,
    } as never);

    mockAdmin.single.mockResolvedValueOnce({
      data: { teacher_id: teacherId, is_booked: true },
      error: null,
    });

    await expect(
      createConstrainedBooking(
        mockSupabase as unknown as SupabaseClient<Database>,
        mockAdmin as unknown as SupabaseClient<Database>,
        userId,
        slotInstanceId,
        scheduledAt,
      ),
    ).rejects.toThrow(SlotAlreadyBookedError);
  });

  it("should throw SlotAlreadyBookedError when lockSlot fails (race)", async () => {
    vi.spyOn(assignments, "getMyAssignment").mockResolvedValue({
      teacher_id: teacherId,
    } as never);

    mockAdmin.single.mockResolvedValueOnce({
      data: { teacher_id: teacherId, is_booked: false },
      error: null,
    });

    vi.spyOn(availability, "lockSlot").mockResolvedValue(false);

    await expect(
      createConstrainedBooking(
        mockSupabase as unknown as SupabaseClient<Database>,
        mockAdmin as unknown as SupabaseClient<Database>,
        userId,
        slotInstanceId,
        scheduledAt,
      ),
    ).rejects.toThrow(SlotAlreadyBookedError);
  });

  it("should unlock the slot (rollback) when booking insert fails", async () => {
    vi.spyOn(assignments, "getMyAssignment").mockResolvedValue({
      teacher_id: teacherId,
    } as never);

    mockAdmin.single.mockResolvedValueOnce({
      data: { teacher_id: teacherId, is_booked: false },
      error: null,
    });

    vi.spyOn(availability, "lockSlot").mockResolvedValue(true);
    const unlockSpy = vi
      .spyOn(availability, "unlockSlot")
      .mockResolvedValue(undefined);

    const bookErr = { code: "23505", message: "duplicate booking" };
    mockSupabase.single.mockResolvedValueOnce({
      data: null,
      error: bookErr,
    });

    await expect(
      createConstrainedBooking(
        mockSupabase as unknown as SupabaseClient<Database>,
        mockAdmin as unknown as SupabaseClient<Database>,
        userId,
        slotInstanceId,
        scheduledAt,
      ),
    ).rejects.toEqual(bookErr);

    // Rollback must release the orphaned slot lock using the admin client.
    expect(unlockSpy).toHaveBeenCalledWith(mockAdmin, slotInstanceId);
  });
});
