import { describe, it, expect, vi, beforeEach } from "vitest";
import { SessionNotFoundError } from "./types";

/**
 * Tests for the endSession use-case orchestrator (ADR-0004, session-end pilot).
 *
 * The orchestrator's value over the two prior inline route paths is that the
 * choreography is testable WITHOUT Playwright: structured input + all I/O
 * behind module imports. These tests pin the behaviours that the teacher and
 * admin paths had drifted apart on — always emit session.ended, idempotent
 * already-ended, and notify-teacher-only-when-forced.
 */

const mockNotify = vi.fn();
const mockNotifyParent = vi.fn();
const mockEmitEvent = vi.fn();
const mockLogError = vi.fn();
const mockRpc = vi.fn();
const mockSessionSingle = vi.fn();
const mockBookingSingle = vi.fn();
const mockAuditInsert = vi.fn();

vi.mock("@/lib/notifications/dispatcher", () => ({
  notify: (...a: unknown[]) => mockNotify(...a),
}));
vi.mock("@/lib/notifications/parent", () => ({
  notifyParentSessionComplete: (...a: unknown[]) => mockNotifyParent(...a),
}));
vi.mock("@/lib/automation/emit", () => ({
  emitEvent: (...a: unknown[]) => mockEmitEvent(...a),
}));
vi.mock("@/lib/logger", () => ({ logError: (...a: unknown[]) => mockLogError(...a) }));
vi.mock("server-only", () => ({}));

// `from(table).select().eq().single()` for sessions / bookings, plus a
// terminal `.insert().then()` for the audit rows.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: table === "sessions" ? mockSessionSingle : mockBookingSingle,
          maybeSingle: table === "sessions" ? mockSessionSingle : mockBookingSingle,
        }),
      }),
      insert: () => ({ then: (cb: (r: { error: unknown }) => void) => cb(mockAuditInsert()) }),
    }),
    rpc: mockRpc,
  }),
}));

import { endSession } from "./orchestrate";

const TEACHER = "teacher-1";
const STUDENT = "student-1";
const SESSION = "session-1";
const BOOKING = "booking-1";

beforeEach(() => {
  vi.clearAllMocks();
  mockEmitEvent.mockResolvedValue(undefined);
  mockNotify.mockResolvedValue(undefined);
  mockNotifyParent.mockResolvedValue(undefined);
  mockRpc.mockResolvedValue({ error: null });
  mockAuditInsert.mockReturnValue({ error: null });
  mockBookingSingle.mockResolvedValue({
    data: { student_id: STUDENT, teacher_id: TEACHER, duration_min: 30, scheduled_at: "2026-06-01T09:00:00Z" },
    error: null,
  });
});

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

    // student notified, but not the teacher (actor === teacher)
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
    // still emits
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
