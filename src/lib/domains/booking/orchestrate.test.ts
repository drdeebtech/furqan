import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  BookingAlreadyConfirmedError,
  BookingConfirmError,
  BookingNoPackageError,
  BookingNotFoundError,
  BookingRoomCreationError,
} from "./types";

/**
 * Tests for the confirmBooking use-case orchestrator (ADR-0004).
 *
 * The orchestrator's value over the previous inline route adapter is
 * exactly that it's testable WITHOUT spinning up Playwright: structured
 * input + structured output + all I/O behind module imports = five
 * `vi.mock(...)` calls cover the entire surface.
 */

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockCreateRoom = vi.fn();
const mockNotify = vi.fn();
const mockEmitEvent = vi.fn();
const mockLogError = vi.fn();
const mockSupabaseRpc = vi.fn();
const mockSupabaseSingle = vi.fn();

vi.mock("@/lib/daily", () => ({
  createRoom: (...args: unknown[]) => mockCreateRoom(...args),
}));

vi.mock("@/lib/notifications/dispatcher", () => ({
  notify: (...args: unknown[]) => mockNotify(...args),
}));

vi.mock("@/lib/automation/emit", () => ({
  emitEvent: (...args: unknown[]) => mockEmitEvent(...args),
}));

vi.mock("@/lib/logger", () => ({
  logError: (...args: unknown[]) => mockLogError(...args),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: mockSupabaseSingle,
        }),
      }),
    }),
    rpc: mockSupabaseRpc,
  }),
}));

// `server-only` is a runtime guard for App Router server modules; it
// throws when imported in a client bundle. Stub to a no-op for tests.
vi.mock("server-only", () => ({}));

// Import AFTER mocks so the orchestrator picks up the mocked versions.
import { confirmBooking } from "./orchestrate";

// ─── Fixtures ───────────────────────────────────────────────────────────────

const BOOKING_ID = "00000000-0000-0000-0000-000000000001";
const STUDENT_ID = "00000000-0000-0000-0000-000000000002";
const TEACHER_ID = "00000000-0000-0000-0000-000000000003";
const ACTOR_ID = TEACHER_ID;
const SESSION_ID = "00000000-0000-0000-0000-000000000099";
const SCHEDULED_AT = "2026-05-08T15:00:00.000Z";
const ROOM_URL = "https://example.daily.co/furqan-test";
const ROOM_NAME = `furqan-${BOOKING_ID.replace(/-/g, "")}`;

const PENDING_BOOKING = {
  status: "pending" as const,
  student_id: STUDENT_ID,
  teacher_id: TEACHER_ID,
  scheduled_at: SCHEDULED_AT,
  duration_min: 30,
};

beforeEach(() => {
  vi.clearAllMocks();
  // Default happy-path mock posture; individual tests override.
  mockSupabaseSingle.mockResolvedValue({ data: PENDING_BOOKING, error: null });
  mockCreateRoom.mockResolvedValue({ url: ROOM_URL, name: ROOM_NAME });
  mockSupabaseRpc.mockResolvedValue({ data: SESSION_ID, error: null });
  mockNotify.mockResolvedValue(undefined);
  mockEmitEvent.mockResolvedValue(undefined);
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("confirmBooking", () => {
  it("returns structured result on the happy path", async () => {
    const result = await confirmBooking({ bookingId: BOOKING_ID, actorId: ACTOR_ID });

    expect(result).toEqual({
      bookingId: BOOKING_ID,
      sessionId: SESSION_ID,
      roomUrl: ROOM_URL,
      roomName: ROOM_NAME,
      studentId: STUDENT_ID,
      teacherId: TEACHER_ID,
    });
  });

  it("calls Daily.co createRoom with a booking-derived deterministic name and a 2-hour expiry", async () => {
    await confirmBooking({ bookingId: BOOKING_ID, actorId: ACTOR_ID });

    expect(mockCreateRoom).toHaveBeenCalledTimes(1);
    const [name, expiresAt] = mockCreateRoom.mock.calls[0];
    expect(name).toBe(ROOM_NAME);
    const expected = new Date(new Date(SCHEDULED_AT).getTime() + 2 * 60 * 60 * 1000);
    expect((expiresAt as Date).toISOString()).toBe(expected.toISOString());
  });

  it("invokes the atomic SQL RPC with the room url, name, and expiry", async () => {
    await confirmBooking({ bookingId: BOOKING_ID, actorId: ACTOR_ID });

    expect(mockSupabaseRpc).toHaveBeenCalledTimes(1);
    const [fnName, args] = mockSupabaseRpc.mock.calls[0];
    expect(fnName).toBe("confirm_booking_with_session");
    expect(args).toMatchObject({
      p_booking_id: BOOKING_ID,
      p_room_url: ROOM_URL,
      p_room_name: ROOM_NAME,
    });
    const expected = new Date(new Date(SCHEDULED_AT).getTime() + 2 * 60 * 60 * 1000).toISOString();
    expect((args as Record<string, string>).p_expires_at).toBe(expected);
  });

  it("emits the booking.confirmed event with student_id, teacher_id, session_id, and actor", async () => {
    await confirmBooking({ bookingId: BOOKING_ID, actorId: ACTOR_ID });

    expect(mockEmitEvent).toHaveBeenCalledWith(
      "booking.confirmed",
      "booking",
      BOOKING_ID,
      {
        student_id: STUDENT_ID,
        teacher_id: TEACHER_ID,
        session_id: SESSION_ID,
      },
      ACTOR_ID,
    );
  });

  it("notifies the student with a booking-typed dispatch", async () => {
    await confirmBooking({ bookingId: BOOKING_ID, actorId: ACTOR_ID });

    expect(mockNotify).toHaveBeenCalledTimes(1);
    const [opts] = mockNotify.mock.calls[0];
    expect(opts).toMatchObject({
      userId: STUDENT_ID,
      type: "booking",
      entityType: "booking",
      entityId: BOOKING_ID,
    });
    expect((opts as { title: string }).title).toContain("تم تأكيد");
  });

  // ─── Failure paths ────────────────────────────────────────────────────────

  it("throws BookingNotFoundError when the booking row is missing, and skips Daily.co + RPC entirely", async () => {
    mockSupabaseSingle.mockResolvedValueOnce({ data: null, error: null });

    await expect(
      confirmBooking({ bookingId: BOOKING_ID, actorId: ACTOR_ID }),
    ).rejects.toBeInstanceOf(BookingNotFoundError);

    expect(mockCreateRoom).not.toHaveBeenCalled();
    expect(mockSupabaseRpc).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
    expect(mockEmitEvent).not.toHaveBeenCalled();
  });

  it("throws BookingConfirmError on a non-not-found pre-read error (e.g. transient DB error)", async () => {
    // PGRST116 ("no rows") is the expected not-found signal and is handled
    // by the `!booking` branch below it; any OTHER error code is an
    // unexpected DB failure and should surface as BookingConfirmError.
    mockSupabaseSingle.mockResolvedValueOnce({
      data: null,
      error: { code: "500", message: "connection reset" },
    });

    await expect(
      confirmBooking({ bookingId: BOOKING_ID, actorId: ACTOR_ID }),
    ).rejects.toBeInstanceOf(BookingConfirmError);

    expect(mockCreateRoom).not.toHaveBeenCalled();
  });

  it("BookingRoomCreationError message falls back when createRoom throws a non-Error", async () => {
    mockCreateRoom.mockRejectedValueOnce("Daily unreachable");

    await expect(
      confirmBooking({ bookingId: BOOKING_ID, actorId: ACTOR_ID }),
    ).rejects.toMatchObject({ message: "Daily.co room creation failed: createRoom failed" });
  });

  it("throws BookingAlreadyConfirmedError when the booking is not pending (pre-read state guard)", async () => {
    mockSupabaseSingle.mockResolvedValueOnce({
      data: { ...PENDING_BOOKING, status: "confirmed" },
      error: null,
    });

    await expect(
      confirmBooking({ bookingId: BOOKING_ID, actorId: ACTOR_ID }),
    ).rejects.toBeInstanceOf(BookingAlreadyConfirmedError);

    expect(mockCreateRoom).not.toHaveBeenCalled();
    expect(mockSupabaseRpc).not.toHaveBeenCalled();
  });

  it("throws BookingRoomCreationError when Daily.co createRoom fails, and never touches the DB", async () => {
    mockCreateRoom.mockRejectedValueOnce(new Error("Daily 503"));

    await expect(
      confirmBooking({ bookingId: BOOKING_ID, actorId: ACTOR_ID }),
    ).rejects.toBeInstanceOf(BookingRoomCreationError);

    // The whole point of pre-DB createRoom: a Daily outage cannot
    // produce a confirmed booking with no room.
    expect(mockSupabaseRpc).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
    expect(mockEmitEvent).not.toHaveBeenCalled();
    expect(mockLogError).toHaveBeenCalled();
  });

  it("translates RPC 'booking_not_pending' to BookingAlreadyConfirmedError (race lost)", async () => {
    mockSupabaseRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "booking_not_pending: detail", code: "P0001" },
    });

    await expect(
      confirmBooking({ bookingId: BOOKING_ID, actorId: ACTOR_ID }),
    ).rejects.toBeInstanceOf(BookingAlreadyConfirmedError);
  });

  it("translates RPC 'no_package_credit' to BookingNoPackageError (fail-closed money guard)", async () => {
    mockSupabaseRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "no_package_credit: detail", code: "P0001" },
    });

    await expect(
      confirmBooking({ bookingId: BOOKING_ID, actorId: ACTOR_ID }),
    ).rejects.toBeInstanceOf(BookingNoPackageError);
    expect(mockLogError).toHaveBeenCalled();
  });

  it("throws BookingConfirmError for unexpected RPC errors (not the race case)", async () => {
    mockSupabaseRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "connection refused", code: "08006" },
    });

    await expect(
      confirmBooking({ bookingId: BOOKING_ID, actorId: ACTOR_ID }),
    ).rejects.toBeInstanceOf(BookingConfirmError);
    expect(mockLogError).toHaveBeenCalled();
  });

  it("throws BookingConfirmError if RPC returns success with no session id", async () => {
    mockSupabaseRpc.mockResolvedValueOnce({ data: null, error: null });

    await expect(
      confirmBooking({ bookingId: BOOKING_ID, actorId: ACTOR_ID }),
    ).rejects.toBeInstanceOf(BookingConfirmError);
  });

  // ─── Best-effort post-commit ──────────────────────────────────────────────

  it("returns success even if notify(student) throws — failure is logged, not propagated", async () => {
    mockNotify.mockRejectedValueOnce(new Error("dispatcher down"));

    const result = await confirmBooking({ bookingId: BOOKING_ID, actorId: ACTOR_ID });

    expect(result.bookingId).toBe(BOOKING_ID);
    expect(result.sessionId).toBe(SESSION_ID);
    expect(mockLogError).toHaveBeenCalledWith(
      expect.stringContaining("notify(student) failed"),
      expect.any(Error),
      expect.any(Object),
    );
  });

  it("returns success even if emitEvent throws — failure is logged, not propagated", async () => {
    mockEmitEvent.mockRejectedValueOnce(new Error("n8n down"));

    const result = await confirmBooking({ bookingId: BOOKING_ID, actorId: ACTOR_ID });

    expect(result.bookingId).toBe(BOOKING_ID);
    expect(mockLogError).toHaveBeenCalledWith(
      expect.stringContaining("emitEvent(booking.confirmed) failed"),
      expect.any(Error),
      expect.any(Object),
    );
  });
});
