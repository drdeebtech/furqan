import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
}));

const { mockDispatchEffects, mockEmitEvent } = vi.hoisted(() => ({
  mockDispatchEffects: vi.fn().mockResolvedValue(undefined),
  mockEmitEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/automation/effects", () => ({
  dispatchEffects: mockDispatchEffects,
}));
vi.mock("@/lib/automation/emit", () => ({
  emitEvent: mockEmitEvent,
}));

import { materializeSingleSessionBooking } from "./materialize";

// Injected-admin test seam — no real Supabase client. `rpc` is the only
// method the module under test calls.
function makeAdmin(rpcResult: { data: unknown; error: { message: string } | null }) {
  const rpc = vi.fn().mockResolvedValue(rpcResult);
  return { admin: { rpc } as never, rpc };
}

const STUDENT_ID = "00000000-0000-1000-8000-000000000001";
const TEACHER_ID = "00000000-0000-1000-8000-000000000002";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("materializeSingleSessionBooking — instant", () => {
  // TRUE VERIFIED DRIFT (not the task brief's "free-eval" framing — see
  // materialize.ts docstring): the paid webhook's instant path emits
  // booking.created; the route's zero-price instant path (paymentId: null)
  // did not. This is the case that must now emit for BOTH.
  it("zero-price instant booking (paymentId null) still emits booking.created — the verified fix", async () => {
    const { admin, rpc } = makeAdmin({ data: "booking-1", error: null });

    const result = await materializeSingleSessionBooking(admin, {
      studentId: STUDENT_ID,
      teacherId: TEACHER_ID,
      bookingType: "instant",
      paymentId: null,
      scheduledAt: "2026-08-01T09:00:00.000Z",
    });

    expect(result).toEqual({ ok: true, bookingId: "booking-1" });
    expect(rpc).toHaveBeenCalledWith(
      "start_instant_session_booking",
      expect.objectContaining({ p_payment_id: undefined, p_scheduled_at: "2026-08-01T09:00:00.000Z" }),
    );
    expect(mockDispatchEffects).toHaveBeenCalledWith(
      "booking.created",
      expect.objectContaining({ teacherId: TEACHER_ID, entityId: "booking-1" }),
    );
    expect(mockEmitEvent).toHaveBeenCalledWith(
      "booking.created",
      "booking",
      "booking-1",
      expect.objectContaining({ student_id: STUDENT_ID, teacher_id: TEACHER_ID }),
    );
  });

  it("paid instant booking (paymentId set) still materializes + emits — byte-identical to the webhook's current behavior", async () => {
    const { admin, rpc } = makeAdmin({ data: "booking-2", error: null });

    const result = await materializeSingleSessionBooking(admin, {
      studentId: STUDENT_ID,
      teacherId: TEACHER_ID,
      bookingType: "instant",
      paymentId: "pay-1",
    });

    expect(result).toEqual({ ok: true, bookingId: "booking-2" });
    expect(rpc).toHaveBeenCalledWith(
      "start_instant_session_booking",
      expect.objectContaining({ p_payment_id: "pay-1" }),
    );
    expect(mockDispatchEffects).toHaveBeenCalledTimes(1);
    expect(mockEmitEvent).toHaveBeenCalledTimes(1);
  });

  it("instant RPC failure returns rpc_failed without emitting", async () => {
    const { admin } = makeAdmin({ data: null, error: { message: "instant rpc down" } });

    const result = await materializeSingleSessionBooking(admin, {
      studentId: STUDENT_ID,
      teacherId: TEACHER_ID,
      bookingType: "instant",
      paymentId: null,
    });

    expect(result).toMatchObject({ ok: false, code: "rpc_failed", error: "instant rpc down" });
    expect(mockDispatchEffects).not.toHaveBeenCalled();
    expect(mockEmitEvent).not.toHaveBeenCalled();
  });
});

describe("materializeSingleSessionBooking — assessment / specialized", () => {
  it("assessment/specialized never emits booking.created — matches the (unfixed) webhook behavior, no drift here", async () => {
    const { admin, rpc } = makeAdmin({ data: "booking-3", error: null });

    const result = await materializeSingleSessionBooking(admin, {
      studentId: STUDENT_ID,
      teacherId: TEACHER_ID,
      bookingType: "assessment",
      paymentId: "pay-2",
      specialty: "hifz",
    });

    expect(result).toEqual({ ok: true, bookingId: "booking-3" });
    expect(rpc).toHaveBeenCalledWith(
      "create_single_session_booking",
      expect.objectContaining({ p_booking_product_type: "assessment", p_specialty: "hifz" }),
    );
    expect(mockDispatchEffects).not.toHaveBeenCalled();
    expect(mockEmitEvent).not.toHaveBeenCalled();
  });

  it("parses target_scope JSON string for specialized bookings", async () => {
    const { admin, rpc } = makeAdmin({ data: "booking-4", error: null });

    await materializeSingleSessionBooking(admin, {
      studentId: STUDENT_ID,
      teacherId: TEACHER_ID,
      bookingType: "specialized",
      paymentId: "pay-3",
      purpose: "consolidate_surah",
      targetScopeRaw: JSON.stringify({ surah: 36 }),
    });

    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_target_scope).toEqual({ surah: 36 });
  });

  it("invalid target_scope JSON returns invalid_target_scope without calling the RPC", async () => {
    const { admin, rpc } = makeAdmin({ data: null, error: null });

    const result = await materializeSingleSessionBooking(admin, {
      studentId: STUDENT_ID,
      teacherId: TEACHER_ID,
      bookingType: "specialized",
      paymentId: "pay-4",
      targetScopeRaw: "{not json",
    });

    expect(result).toMatchObject({
      ok: false,
      code: "invalid_target_scope",
      error: "target_scope metadata is not valid JSON",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  // A concurrent duplicate free-evaluation race hits the DB backstop index;
  // must map to a distinct code so the route can return a friendly 409
  // instead of the RPC's raw duplicate-key message.
  it("a race-409 (uniq_active_assessment_per_student) maps to code duplicate_active_assessment", async () => {
    const { admin } = makeAdmin({
      data: null,
      error: {
        message:
          'duplicate key value violates unique constraint "uniq_active_assessment_per_student"',
      },
    });

    const result = await materializeSingleSessionBooking(admin, {
      studentId: STUDENT_ID,
      teacherId: TEACHER_ID,
      bookingType: "assessment",
      paymentId: null,
      specialty: "hifz",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("duplicate_active_assessment");
      // Original rpcErr.message preserved verbatim for the caller's log/telemetry.
      expect(result.error).toContain("uniq_active_assessment_per_student");
    }
  });

  it("a non-duplicate RPC failure maps to rpc_failed", async () => {
    const { admin } = makeAdmin({ data: null, error: { message: "some other db error" } });

    const result = await materializeSingleSessionBooking(admin, {
      studentId: STUDENT_ID,
      teacherId: TEACHER_ID,
      bookingType: "specialized",
      paymentId: "pay-5",
      purpose: "review",
    });

    expect(result).toMatchObject({ ok: false, code: "rpc_failed", error: "some other db error" });
  });
});
