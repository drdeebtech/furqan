import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logError: vi.fn(), logInfo: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/domains/package/ledger", () => ({ selectActivePackage: vi.fn() }));
vi.mock("../agreement-gate", () => ({ teacherAgreementOk: vi.fn() }));

import { createAdminClient } from "@/lib/supabase/admin";
import { selectActivePackage } from "@/lib/domains/package/ledger";
import { teacherAgreementOk } from "../agreement-gate";
import { createBooking, updateBookingStatus } from "../actions";
import {
  BookingConflictError,
  BookingNotFoundError,
  type CreateBookingInput,
} from "../types";
import type { SessionType } from "@/types/database";

/**
 * Unit coverage for the booking write surface (audit follow-up: this module
 * had no test). Exercises the fail-closed package precondition, server-trusted
 * teacher validation, the happy path, the overlap-conflict mapping, and the
 * status-transition short-circuit / not-found paths.
 */

// ── Supabase mock ───────────────────────────────────────────────────────────
// A chainable, awaitable query-builder. Chain methods return the builder;
// terminal `.single()/.maybeSingle()/.returns()` and `await` resolve the
// per-table result `{ data, error }`.
function makeQB({ data = null, error = null }: { data?: unknown; error?: unknown }) {
  const res = { data, error };
  const qb: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "order", "limit", "insert", "update"]) {
    qb[m] = vi.fn(() => qb);
  }
  qb.single = vi.fn(() => Promise.resolve(res));
  qb.maybeSingle = vi.fn(() => Promise.resolve(res));
  qb.returns = vi.fn(() => Promise.resolve(res));
  qb.then = (resolve: (v: typeof res) => unknown) => Promise.resolve(res).then(resolve);
  return qb;
}

function makeAdmin(byTable: Record<string, { data?: unknown; error?: unknown }>) {
  return { from: vi.fn((table: string) => makeQB(byTable[table] ?? { data: null, error: null })) };
}

const baseInput = (over: Partial<CreateBookingInput> = {}): CreateBookingInput => ({
  studentId: "stu-1",
  teacherId: "tch-1",
  sessionType: "memorization" as SessionType,
  durationMin: 60,
  scheduledAt: new Date("2999-01-01T10:00:00.000Z"),
  localDate: "2999-01-01",
  localTime: "10:00",
  notes: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(selectActivePackage).mockResolvedValue({ id: "pkg-1" } as never);
  vi.mocked(teacherAgreementOk).mockResolvedValue(true as never);
});

describe("createBooking", () => {
  it("throws BookingValidationError(student_package) when no active package", async () => {
    vi.mocked(selectActivePackage).mockResolvedValue(null as never);
    vi.mocked(createAdminClient).mockReturnValue(makeAdmin({}) as never);
    await expect(createBooking(baseInput())).rejects.toMatchObject({
      name: "BookingValidationError",
      field: "student_package",
    });
  });

  it("throws BookingValidationError(teacher_id) when teacher not found/accepting", async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      makeAdmin({ teacher_profiles: { data: null } }) as never,
    );
    await expect(createBooking(baseInput())).rejects.toMatchObject({
      field: "teacher_id",
    });
  });

  it("throws BookingValidationError(teacher_id) when the agreement gate denies (fail-closed)", async () => {
    vi.mocked(teacherAgreementOk).mockResolvedValue(false as never);
    vi.mocked(createAdminClient).mockReturnValue(
      makeAdmin({
        teacher_profiles: { data: { hourly_rate: 10, specialties: ["memorization"] } },
      }) as never,
    );
    await expect(createBooking(baseInput())).rejects.toMatchObject({
      name: "BookingValidationError",
      field: "teacher_id",
    });
    // Gate consulted for the SAME teacher the booking targets (no IDOR drift).
    expect(teacherAgreementOk).toHaveBeenCalledWith(expect.anything(), "tch-1");
  });

  it("throws BookingValidationError(session_type) when type not in specialties", async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      makeAdmin({
        teacher_profiles: { data: { hourly_rate: 10, specialties: ["tajweed"] } },
      }) as never,
    );
    await expect(
      createBooking(baseInput({ sessionType: "memorization" as SessionType })),
    ).rejects.toMatchObject({ field: "session_type" });
  });

  it("throws BookingValidationError(scheduled_at) when more than 30 min in the past", async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      makeAdmin({
        teacher_profiles: { data: { hourly_rate: 10, specialties: ["memorization"] } },
      }) as never,
    );
    await expect(
      createBooking(baseInput({ scheduledAt: new Date(Date.now() - 3_600_000) })),
    ).rejects.toMatchObject({ field: "scheduled_at" });
  });

  it("returns the created booking on the happy path (empty availability => no slot gate)", async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      makeAdmin({
        teacher_profiles: { data: { hourly_rate: 10, specialties: ["memorization"] } },
        teacher_availability: { data: [] },
        availability_exceptions: { data: [] },
        bookings: { data: { id: "booking-1" } },
      }) as never,
    );
    const res = await createBooking(baseInput());
    expect(res.id).toBe("booking-1");
    expect(res.rateSnapshot).toBe(10);
    expect(typeof res.amountUsd).toBe("number");
  });

  it("maps the no_booking_overlap constraint to BookingConflictError", async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      makeAdmin({
        teacher_profiles: { data: { hourly_rate: 10, specialties: ["memorization"] } },
        teacher_availability: { data: [] },
        availability_exceptions: { data: [] },
        bookings: { data: null, error: { message: 'conflict on "no_booking_overlap"' } },
      }) as never,
    );
    await expect(createBooking(baseInput())).rejects.toBeInstanceOf(BookingConflictError);
  });
});

describe("updateBookingStatus", () => {
  it("throws BookingNotFoundError when the booking does not exist", async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      makeAdmin({ bookings: { data: null } }) as never,
    );
    await expect(
      updateBookingStatus({ bookingId: "missing", newStatus: "confirmed", actorId: "a-1" }),
    ).rejects.toBeInstanceOf(BookingNotFoundError);
  });

  it("short-circuits (no write) when already in target state", async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      makeAdmin({
        bookings: {
          data: { id: "b-1", status: "confirmed", student_id: "s-1", teacher_id: "t-1" },
        },
      }) as never,
    );
    const res = await updateBookingStatus({
      bookingId: "b-1",
      newStatus: "confirmed",
      actorId: "a-1",
    });
    expect(res.alreadyInTargetState).toBe(true);
    expect(res.oldStatus).toBe("confirmed");
  });

  it("transitions status and returns the previous state", async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      makeAdmin({
        bookings: {
          data: { id: "b-1", status: "pending", student_id: "s-1", teacher_id: "t-1" },
          error: null,
        },
      }) as never,
    );
    const res = await updateBookingStatus({
      bookingId: "b-1",
      newStatus: "confirmed",
      actorId: "a-1",
      reason: "manual",
    });
    expect(res.alreadyInTargetState).toBe(false);
    expect(res.oldStatus).toBe("pending");
    expect(res.newStatus).toBe("confirmed");
    expect(res.studentId).toBe("s-1");
  });
});
