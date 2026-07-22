import { describe, it, expect, vi, beforeEach } from "vitest";
import { updateBookingStatus } from "./actions";
import { notify } from "@/lib/notifications/dispatcher";
import { emitEvent } from "@/lib/automation/emit";
import { BookingNotFoundError } from "./types";

vi.mock("./actions", () => ({ updateBookingStatus: vi.fn() }));
vi.mock("@/lib/notifications/dispatcher", () => ({ notify: vi.fn() }));
vi.mock("@/lib/automation/emit", () => ({ emitEvent: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

// `server-only` is a runtime guard for App Router server modules; it
// throws when imported in a client bundle. Stub to a no-op for tests
// (orchestrate.ts imports it at module scope).
vi.mock("server-only", () => ({}));

// Import AFTER mocks so the orchestrator picks up the mocked versions.
import { cancelBooking } from "./orchestrate";

const writeOk = {
  id: "b1",
  oldStatus: "pending",
  newStatus: "cancelled",
  studentId: "s1",
  teacherId: "t1",
  alreadyInTargetState: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(updateBookingStatus).mockResolvedValue(writeOk as never);
  vi.mocked(notify).mockResolvedValue(undefined);
  vi.mocked(emitEvent).mockResolvedValue(undefined as never);
});

describe("cancelBooking", () => {
  it("teacher cancel: writes via domain, notifies student with the teacher wording, emits booking.cancelled", async () => {
    const res = await cancelBooking({ bookingId: "b1", actorId: "t1", actorRole: "teacher" });

    expect(updateBookingStatus).toHaveBeenCalledWith({
      bookingId: "b1",
      newStatus: "cancelled",
      actorId: "t1",
      reason: undefined,
    });
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "s1",
        title: "تم رفض حجزك",
        body: "للأسف تم رفض حجزك من قبل المعلم — يمكنك حجز موعد آخر",
        entityType: "booking",
        entityId: "b1",
        type: "booking",
      }),
    );
    expect(emitEvent).toHaveBeenCalledWith(
      "booking.cancelled",
      "booking",
      "b1",
      { student_id: "s1", teacher_id: "t1", new_status: "cancelled" },
      "t1",
    );
    expect(res).toEqual({ bookingId: "b1", studentId: "s1", teacherId: "t1", alreadyCancelled: false });
  });

  it("admin cancel uses the admin wording", async () => {
    await cancelBooking({ bookingId: "b1", actorId: "a1", actorRole: "admin" });

    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "تم إلغاء حجزك",
        body: "تم إلغاء حجزك من قبل الإدارة — يمكنك حجز موعد بديل",
      }),
    );
  });

  it("already-cancelled: no notify, no emit, alreadyCancelled=true", async () => {
    vi.mocked(updateBookingStatus).mockResolvedValue({ ...writeOk, alreadyInTargetState: true } as never);

    const res = await cancelBooking({ bookingId: "b1", actorId: "t1", actorRole: "teacher" });

    expect(notify).not.toHaveBeenCalled();
    expect(emitEvent).not.toHaveBeenCalled();
    expect(res.alreadyCancelled).toBe(true);
  });

  it("propagates domain-write errors without side effects", async () => {
    vi.mocked(updateBookingStatus).mockRejectedValue(new BookingNotFoundError("b1"));

    await expect(cancelBooking({ bookingId: "b1", actorId: "t1", actorRole: "teacher" })).rejects.toBeInstanceOf(
      BookingNotFoundError,
    );
    expect(notify).not.toHaveBeenCalled();
    expect(emitEvent).not.toHaveBeenCalled();
  });

  it("emit failure is best-effort: still resolves, notify already sent", async () => {
    vi.mocked(emitEvent).mockRejectedValue(new Error("n8n down"));

    await expect(cancelBooking({ bookingId: "b1", actorId: "t1", actorRole: "teacher" })).resolves.toMatchObject({
      alreadyCancelled: false,
    });
    expect(notify).toHaveBeenCalled();
  });

  it("passes reason through to the domain write", async () => {
    await cancelBooking({ bookingId: "b1", actorId: "a1", actorRole: "admin", reason: "Admin set booking cancelled" });

    expect(updateBookingStatus).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "Admin set booking cancelled" }),
    );
  });
});
