import { describe, it, expect, vi, beforeEach } from "vitest";
import { SessionNotFoundError, StartInstantSessionError } from "./types";

/**
 * Tests for session domain orchestrators (ADR-0004):
 * - endSession: session-end pilot (teacher, admin force-end, idempotency)
 * - startInstantSession: package check → debit → booking → room → session
 * - recordNoShow: booking status update + fan-out notifications
 */

const mockNotify = vi.fn();
const mockNotifyParent = vi.fn();
const mockNotifyParentNoShow = vi.fn();
const mockEmitEvent = vi.fn();
const mockLogError = vi.fn();
const mockRpc = vi.fn();
const mockSessionSingle = vi.fn();
const mockBookingSingle = vi.fn();
const mockAuditInsert = vi.fn();
const mockSelectActivePackage = vi.fn();
const mockDebitPackage = vi.fn();
const mockCreateRoom = vi.fn();
const mockDispatchEffects = vi.fn();
const mockBookingInsertSingle = vi.fn();
const mockSessionInsertSingle = vi.fn();
const mockBookingUpdateEq = vi.fn();
const mockSessionUpdateEq = vi.fn();

vi.mock("@/lib/notifications/dispatcher", () => ({
  notify: (...a: unknown[]) => mockNotify(...a),
}));
vi.mock("@/lib/notifications/parent", () => ({
  notifyParentSessionComplete: (...a: unknown[]) => mockNotifyParent(...a),
  notifyParentNoShow: (...a: unknown[]) => mockNotifyParentNoShow(...a),
}));
vi.mock("@/lib/automation/emit", () => ({
  emitEvent: (...a: unknown[]) => mockEmitEvent(...a),
}));
vi.mock("@/lib/automation/effects", () => ({
  dispatchEffects: (...a: unknown[]) => mockDispatchEffects(...a),
}));
vi.mock("@/lib/logger", () => ({ logError: (...a: unknown[]) => mockLogError(...a) }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/domains/package/ledger", () => ({
  selectActivePackage: (...a: unknown[]) => mockSelectActivePackage(...a),
  debitPackage: (...a: unknown[]) => mockDebitPackage(...a),
}));
vi.mock("@/lib/daily", () => ({
  createRoom: (...a: unknown[]) => mockCreateRoom(...a),
}));

// Supabase mock supports all chain shapes used by the three orchestrators:
//   select().eq().{single,maybeSingle}   — endSession / recordNoShow reads
//   insert().select().single()           — startInstantSession booking + session rows
//   insert().then()                      — audit_log writes in endSession
//   update().eq()                        — recordNoShow status + ended_at writes
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: table === "sessions" ? mockSessionSingle : mockBookingSingle,
          maybeSingle: table === "sessions" ? mockSessionSingle : mockBookingSingle,
        }),
      }),
      insert: () => ({
        then: (cb: (r: { error: unknown }) => void) => cb(mockAuditInsert()),
        select: () => ({
          single: table === "sessions" ? mockSessionInsertSingle : mockBookingInsertSingle,
        }),
      }),
      update: () => ({
        eq: () => (table === "sessions" ? mockSessionUpdateEq() : mockBookingUpdateEq()),
      }),
    }),
    rpc: mockRpc,
  }),
}));

import { endSession, startInstantSession, recordNoShow } from "./orchestrate";

const TEACHER = "teacher-1";
const STUDENT = "student-1";
const SESSION = "session-1";
const BOOKING = "booking-1";
const PKG_ID = "pkg-1";
const ROOM_URL = "https://furqan.daily.co/test-room";

beforeEach(() => {
  vi.clearAllMocks();
  mockEmitEvent.mockResolvedValue(undefined);
  mockNotify.mockResolvedValue(undefined);
  mockNotifyParent.mockResolvedValue(undefined);
  mockNotifyParentNoShow.mockResolvedValue(undefined);
  mockDispatchEffects.mockResolvedValue(undefined);
  mockRpc.mockResolvedValue({ error: null });
  mockAuditInsert.mockReturnValue({ error: null });
  mockBookingUpdateEq.mockResolvedValue({ error: null });
  mockSessionUpdateEq.mockResolvedValue({ error: null });
  // startInstantSession defaults
  mockSelectActivePackage.mockResolvedValue({ id: PKG_ID });
  mockDebitPackage.mockResolvedValue({ ok: true });
  mockBookingInsertSingle.mockResolvedValue({ data: { id: BOOKING }, error: null });
  mockCreateRoom.mockResolvedValue({ name: "test-room", url: ROOM_URL });
  mockSessionInsertSingle.mockResolvedValue({ data: { id: SESSION }, error: null });
  // endSession / recordNoShow booking read defaults
  mockBookingSingle.mockResolvedValue({
    data: { student_id: STUDENT, teacher_id: TEACHER, duration_min: 30, scheduled_at: "2026-06-01T09:00:00Z" },
    error: null,
  });
});

// ─── endSession ──────────────────────────────────────────────────────────────

describe("endSession", () => {
  it("ends an active session: atomic RPC + always emits session.ended", async () => {
    mockSessionSingle.mockResolvedValue({
      data: { booking_id: BOOKING, started_at: "2026-06-01T10:00:00Z", ended_at: null },
      error: null,
    });

    const res = await endSession({ sessionId: SESSION, actorId: TEACHER });

    expect(res.alreadyEnded).toBe(false);
    expect(res.bookingId).toBe(BOOKING);
    expect(mockRpc).toHaveBeenCalledWith("end_session_with_booking", {
      p_session_id: SESSION,
      p_actual_duration: expect.any(Number),
    });
    expect(mockEmitEvent).toHaveBeenCalledWith(
      "session.ended",
      "session",
      SESSION,
      expect.objectContaining({ booking_id: BOOKING, teacher_id: TEACHER }),
    );
  });

  it("does NOT notify the teacher when the teacher ends their own session", async () => {
    mockSessionSingle.mockResolvedValue({
      data: { booking_id: BOOKING, started_at: "2026-06-01T10:00:00Z", ended_at: null },
      error: null,
    });

    await endSession({ sessionId: SESSION, actorId: TEACHER });

    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ userId: STUDENT }));
  });

  it("notifies the teacher when an admin force-ends the session", async () => {
    mockSessionSingle.mockResolvedValue({
      data: { booking_id: BOOKING, started_at: "2026-06-01T10:00:00Z", ended_at: null },
      error: null,
    });

    await endSession({ sessionId: SESSION, actorId: "admin-9", reason: "policy" });

    const recipients = mockNotify.mock.calls.map((c) => (c[0] as { userId: string }).userId);
    expect(recipients).toContain(STUDENT);
    expect(recipients).toContain(TEACHER);
    expect(mockEmitEvent).toHaveBeenCalled();
  });

  it("is idempotent: an already-ended session returns alreadyEnded without the RPC", async () => {
    mockSessionSingle.mockResolvedValue({
      data: { booking_id: BOOKING, started_at: "2026-06-01T10:00:00Z", ended_at: "2026-06-01T10:30:00Z" },
      error: null,
    });

    const res = await endSession({ sessionId: SESSION, actorId: TEACHER });

    expect(res.alreadyEnded).toBe(true);
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockEmitEvent).not.toHaveBeenCalled();
  });

  it("maps a lost race (session_already_ended raise) to an idempotent result", async () => {
    mockSessionSingle.mockResolvedValue({
      data: { booking_id: BOOKING, started_at: "2026-06-01T10:00:00Z", ended_at: null },
      error: null,
    });
    mockRpc.mockResolvedValue({ error: { message: "session_already_ended" } });

    const res = await endSession({ sessionId: SESSION, actorId: TEACHER });
    expect(res.alreadyEnded).toBe(true);
  });

  it("throws SessionNotFoundError when the session does not exist", async () => {
    mockSessionSingle.mockResolvedValue({ data: null, error: null });
    await expect(endSession({ sessionId: SESSION, actorId: TEACHER })).rejects.toBeInstanceOf(
      SessionNotFoundError,
    );
  });
});

// ─── startInstantSession ─────────────────────────────────────────────────────

describe("startInstantSession", () => {
  const input = { teacherId: TEACHER, studentId: STUDENT, durationMin: 30, hourlyRate: 40 };

  it("happy path: returns sessionId, bookingId, and roomUrl", async () => {
    const result = await startInstantSession(input);
    expect(result).toEqual({ sessionId: SESSION, bookingId: BOOKING, roomUrl: ROOM_URL });
  });

  it("throws StartInstantSessionError when no active package exists", async () => {
    mockSelectActivePackage.mockResolvedValue(null);
    await expect(startInstantSession(input)).rejects.toBeInstanceOf(StartInstantSessionError);
  });

  it("throws with exhausted message when debit reason is 'exhausted'", async () => {
    mockDebitPackage.mockResolvedValue({ ok: false, reason: "exhausted" });
    await expect(startInstantSession(input)).rejects.toThrow("هذه الباقة منتهية أو مستهلكة");
  });

  it("throws with generic debit message for any other debit failure", async () => {
    mockDebitPackage.mockResolvedValue({ ok: false, reason: "unknown" });
    await expect(startInstantSession(input)).rejects.toThrow("تعذر خصم رصيد الباقة");
  });

  it("throws StartInstantSessionError when booking insert fails", async () => {
    mockBookingInsertSingle.mockResolvedValue({ data: null, error: { message: "constraint violation" } });
    await expect(startInstantSession(input)).rejects.toBeInstanceOf(StartInstantSessionError);
  });

  it("throws StartInstantSessionError when createRoom throws", async () => {
    mockCreateRoom.mockRejectedValue(new Error("Daily API unavailable"));
    await expect(startInstantSession(input)).rejects.toThrow(
      "تم إنشاء الحجز لكن فشل إنشاء غرفة الفيديو",
    );
  });

  it("throws StartInstantSessionError when session insert fails", async () => {
    mockSessionInsertSingle.mockResolvedValue({ data: null, error: { message: "sessions constraint" } });
    await expect(startInstantSession(input)).rejects.toThrow(
      "تم إنشاء الحجز لكن فشل تسجيل الجلسة",
    );
  });

  it("swallows notify failure and still emits session.instant_started", async () => {
    mockNotify.mockRejectedValue(new Error("push service down"));
    const result = await startInstantSession(input);
    expect(result.sessionId).toBe(SESSION);
    expect(mockEmitEvent).toHaveBeenCalledWith(
      "session.instant_started",
      "session",
      SESSION,
      expect.objectContaining({ teacher_id: TEACHER, student_id: STUDENT }),
      TEACHER,
    );
  });
});

// ─── recordNoShow ─────────────────────────────────────────────────────────────

describe("recordNoShow", () => {
  const input = { bookingId: BOOKING, actorId: TEACHER };

  beforeEach(() => {
    // Override booking read to return only the fields recordNoShow needs.
    mockBookingSingle.mockResolvedValue({
      data: { student_id: STUDENT, teacher_id: TEACHER },
      error: null,
    });
  });

  it("happy path: updates booking status, dispatches effects, and emits no_show event", async () => {
    await recordNoShow(input);
    expect(mockBookingUpdateEq).toHaveBeenCalled();
    expect(mockDispatchEffects).toHaveBeenCalledWith(
      "session.no_show",
      expect.objectContaining({ studentId: STUDENT, entityId: BOOKING }),
    );
    expect(mockEmitEvent).toHaveBeenCalledWith(
      "session.no_show",
      "booking",
      BOOKING,
      expect.objectContaining({ student_id: STUDENT, teacher_id: TEACHER }),
      TEACHER,
    );
  });

  it("throws when the booking read returns a DB error", async () => {
    mockBookingSingle.mockResolvedValue({ data: null, error: { message: "read error" } });
    await expect(recordNoShow(input)).rejects.toThrow("recordNoShow: booking read failed");
  });

  it("throws when the booking row is not found", async () => {
    mockBookingSingle.mockResolvedValue({ data: null, error: null });
    await expect(recordNoShow(input)).rejects.toThrow("الحجز غير موجود");
  });

  it("rethrows the DB error when bookings status update fails", async () => {
    const dbError = new Error("unique constraint violated");
    mockBookingUpdateEq.mockResolvedValue({ error: dbError });
    await expect(recordNoShow(input)).rejects.toBe(dbError);
  });

  it("logs session ended_at failure but resolves normally (non-blocking)", async () => {
    mockSessionUpdateEq.mockResolvedValue({ error: new Error("no session row exists") });
    await expect(recordNoShow(input)).resolves.toBeUndefined();
    expect(mockLogError).toHaveBeenCalled();
    expect(mockDispatchEffects).toHaveBeenCalled();
  });

  it("swallows notifyParentNoShow failure and still emits the event", async () => {
    mockNotifyParentNoShow.mockRejectedValue(new Error("parent notify failed"));
    await expect(recordNoShow(input)).resolves.toBeUndefined();
    expect(mockEmitEvent).toHaveBeenCalledWith("session.no_show", expect.any(String), BOOKING, expect.any(Object), TEACHER);
  });
});
