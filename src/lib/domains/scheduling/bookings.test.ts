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
vi.mock("@/lib/domains/booking/agreement-gate", () => ({ teacherAgreementOk: vi.fn() }));

import { teacherAgreementOk } from "@/lib/domains/booking/agreement-gate";
import { TeacherUnavailableError } from "./bookings";

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
    maybeSingle: vi.fn(),
  };

  const userId = "student-123";
  const slotInstanceId = "slot-456";
  const teacherId = "teacher-789";
  // Slot row now carries the canonical date + time; scheduled_at is derived.
  const slotDate = "2026-07-01";
  const slotStartTime = "10:00:00";
  const expectedScheduledAt = `${slotDate}T${slotStartTime}Z`;

  const slotRow = (overrides: Partial<{ teacher_id: string; is_booked: boolean; slot_date: string; start_time: string }> = {}) => ({
    teacher_id: teacherId,
    is_booked: false,
    slot_date: slotDate,
    start_time: slotStartTime,
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Spec 040 gate is dormant by default in these tests (returns ok); a
    // dedicated test flips it to deny. Keeps the pre-existing cases green.
    vi.mocked(teacherAgreementOk).mockResolvedValue(true as never);
  });

  it("should create a booking with scheduled_at derived from the slot instance", async () => {
    vi.spyOn(assignments, "getMyAssignment").mockResolvedValue({
      teacher_id: teacherId,
    } as never);

    mockAdmin.single.mockResolvedValueOnce({
      data: slotRow(),
      error: null,
    });

    vi.spyOn(availability, "lockSlot").mockResolvedValue(true);

    // Plan lookup → session length comes from the subscription plan.
    mockAdmin.maybeSingle.mockResolvedValueOnce({
      data: { subscription_plans: { session_duration_min: 30 } },
      error: null,
    });

    mockSupabase.single.mockResolvedValueOnce({
      data: { id: "booking-001" },
      error: null,
    });

    const result = await createConstrainedBooking(
      mockSupabase as unknown as SupabaseClient<Database>,
      mockAdmin as unknown as SupabaseClient<Database>,
      userId,
      slotInstanceId,
    );

    expect(result).toBe("booking-001");
    expect(mockSupabase.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        student_id: userId,
        teacher_id: teacherId,
        scheduled_at: expectedScheduledAt, // derived server-side, not from client
        status: "pending",
        amount_usd: 0,
        duration_min: 30, // sourced from subscription_plans.session_duration_min
        rate_snapshot: 0,
      }),
    );
  });

  it("falls back to 60-minute duration when the plan has none", async () => {
    vi.spyOn(assignments, "getMyAssignment").mockResolvedValue({
      teacher_id: teacherId,
    } as never);

    mockAdmin.single.mockResolvedValueOnce({ data: slotRow(), error: null });
    vi.spyOn(availability, "lockSlot").mockResolvedValue(true);
    mockAdmin.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    mockSupabase.single.mockResolvedValueOnce({ data: { id: "booking-002" }, error: null });

    await createConstrainedBooking(
      mockSupabase as unknown as SupabaseClient<Database>,
      mockAdmin as unknown as SupabaseClient<Database>,
      userId,
      slotInstanceId,
    );

    expect(mockSupabase.insert).toHaveBeenCalledWith(
      expect.objectContaining({ duration_min: 60 }),
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
      ),
    ).rejects.toThrow(AssignmentNotFoundError);
  });

  it("throws TeacherUnavailableError when the agreement gate denies (fail-closed) and never inserts", async () => {
    vi.spyOn(assignments, "getMyAssignment").mockResolvedValue({ teacher_id: teacherId } as never);
    mockAdmin.single.mockResolvedValueOnce({ data: slotRow(), error: null });
    vi.mocked(teacherAgreementOk).mockResolvedValue(false as never);

    await expect(
      createConstrainedBooking(
        mockSupabase as unknown as SupabaseClient<Database>,
        mockAdmin as unknown as SupabaseClient<Database>,
        userId,
        slotInstanceId,
      ),
    ).rejects.toThrow(TeacherUnavailableError);

    // Gate consulted the server-resolved slot teacher (no IDOR), and we bailed
    // before reserving/inserting anything.
    expect(teacherAgreementOk).toHaveBeenCalledWith(mockAdmin, teacherId);
    expect(mockSupabase.insert).not.toHaveBeenCalled();
  });

  it("should throw TeacherMismatchError when teacher does not match", async () => {
    vi.spyOn(assignments, "getMyAssignment").mockResolvedValue({
      teacher_id: teacherId,
    } as never);

    mockAdmin.single.mockResolvedValueOnce({
      data: slotRow({ teacher_id: "other-teacher" }),
      error: null,
    });

    await expect(
      createConstrainedBooking(
        mockSupabase as unknown as SupabaseClient<Database>,
        mockAdmin as unknown as SupabaseClient<Database>,
        userId,
        slotInstanceId,
      ),
    ).rejects.toThrow(TeacherMismatchError);
  });

  it("should throw SlotAlreadyBookedError when slot is already booked", async () => {
    vi.spyOn(assignments, "getMyAssignment").mockResolvedValue({
      teacher_id: teacherId,
    } as never);

    mockAdmin.single.mockResolvedValueOnce({
      data: slotRow({ is_booked: true }),
      error: null,
    });

    await expect(
      createConstrainedBooking(
        mockSupabase as unknown as SupabaseClient<Database>,
        mockAdmin as unknown as SupabaseClient<Database>,
        userId,
        slotInstanceId,
      ),
    ).rejects.toThrow(SlotAlreadyBookedError);
  });

  it("should throw SlotAlreadyBookedError when lockSlot fails (race)", async () => {
    vi.spyOn(assignments, "getMyAssignment").mockResolvedValue({
      teacher_id: teacherId,
    } as never);

    mockAdmin.single.mockResolvedValueOnce({
      data: slotRow(),
      error: null,
    });

    vi.spyOn(availability, "lockSlot").mockResolvedValue(false);

    await expect(
      createConstrainedBooking(
        mockSupabase as unknown as SupabaseClient<Database>,
        mockAdmin as unknown as SupabaseClient<Database>,
        userId,
        slotInstanceId,
      ),
    ).rejects.toThrow(SlotAlreadyBookedError);
  });

  it("should unlock the slot (rollback) when booking insert fails", async () => {
    vi.spyOn(assignments, "getMyAssignment").mockResolvedValue({
      teacher_id: teacherId,
    } as never);

    mockAdmin.single.mockResolvedValueOnce({
      data: slotRow(),
      error: null,
    });

    vi.spyOn(availability, "lockSlot").mockResolvedValue(true);
    const unlockSpy = vi
      .spyOn(availability, "unlockSlot")
      .mockResolvedValue(undefined);

    mockAdmin.maybeSingle.mockResolvedValueOnce({ data: null, error: null });

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
      ),
    ).rejects.toEqual(bookErr);

    // Rollback must release the orphaned slot lock using the admin client.
    expect(unlockSpy).toHaveBeenCalledWith(mockAdmin, slotInstanceId);
  });
});
