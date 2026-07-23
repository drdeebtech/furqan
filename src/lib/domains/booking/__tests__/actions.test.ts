import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logError: vi.fn(), logInfo: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/domains/package/ledger", () => ({ selectActivePackage: vi.fn() }));
vi.mock("../agreement-gate", () => ({ teacherAgreementOk: vi.fn() }));

import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/logger";
import { selectActivePackage } from "@/lib/domains/package/ledger";
import { teacherAgreementOk } from "../agreement-gate";
import { createBooking, updateBookingStatus } from "../actions";
import {
  BookingConflictError,
  BookingNotFoundError,
  BookingStatusUpdateError,
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
// `.single()/.maybeSingle()/.returns()` resolve the pre-read/insert shape
// (`{ data, error }`, `data` a single row or null). A bare `await` on the
// builder (no `.single()` — the conditional-UPDATE `.select("id")` path and
// the audit-row insert) resolves the list shape (`{ data, error }`, `data`
// an array) via `.then` — mirrors the two different terminal shapes
// `updateBookingStatus` actually reads post-#770 (row-array from the
// conditional UPDATE vs. a single row from the pre-read / re-read).
function makeQB(
  {
    data = null,
    error = null,
    count,
    updateRows,
    updateError = null,
  }: {
    data?: unknown;
    error?: unknown;
    count?: number;
    updateRows?: unknown[];
    updateError?: unknown;
  },
  // Shared (not copied) across every `.from(table)` call for this table
  // within one test, so successive `.single()` calls — pre-read, then a
  // later re-read — pop one result each instead of each new query-builder
  // instance re-reading from the start of a fresh copy.
  sharedSingleQueue?: Array<{ data?: unknown; error?: unknown }>,
) {
  const singleRes = { data, error };
  const listRes = {
    data: updateRows !== undefined ? updateRows : data ? [data] : [],
    error: updateError,
    count: count ?? null,
  };
  const nextSingle = () => {
    if (sharedSingleQueue && sharedSingleQueue.length > 0) {
      const n = sharedSingleQueue.shift()!;
      return { data: n.data ?? null, error: n.error ?? null };
    }
    return singleRes;
  };
  const qb: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "in", "order", "limit", "insert", "update"]) {
    qb[m] = vi.fn(() => qb);
  }
  qb.single = vi.fn(() => Promise.resolve(nextSingle()));
  qb.maybeSingle = vi.fn(() => Promise.resolve(nextSingle()));
  qb.returns = vi.fn(() => Promise.resolve(singleRes));
  qb.then = (resolve: (v: typeof listRes) => unknown) => Promise.resolve(listRes).then(resolve);
  return qb;
}

function makeAdmin(
  byTable: Record<
    string,
    {
      data?: unknown;
      error?: unknown;
      count?: number;
      updateRows?: unknown[];
      updateError?: unknown;
      // Successive `.single()`/`.maybeSingle()` calls across ALL `.from(table)`
      // invocations for this table pop one result each (pre-read, then a
      // later re-read) before falling back to `{ data, error }`. Only needed
      // for the race-then-re-read scenario in `updateBookingStatus`.
      singleSequence?: Array<{ data?: unknown; error?: unknown }>;
    }
  >,
) {
  const queuesByTable: Record<string, Array<{ data?: unknown; error?: unknown }>> = {};
  for (const [table, cfg] of Object.entries(byTable)) {
    if (cfg.singleSequence) queuesByTable[table] = [...cfg.singleSequence];
  }
  return {
    from: vi.fn((table: string) =>
      makeQB(byTable[table] ?? { data: null, error: null }, queuesByTable[table]),
    ),
  };
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
    const admin = makeAdmin({
      teacher_profiles: { data: { hourly_rate: 10, specialties: ["memorization"] } },
    });
    vi.mocked(createAdminClient).mockReturnValue(admin as never);
    await expect(createBooking(baseInput())).rejects.toMatchObject({
      name: "BookingValidationError",
      field: "teacher_id",
    });
    // Gate consulted for the SAME teacher the booking targets (no IDOR drift).
    expect(teacherAgreementOk).toHaveBeenCalledWith(expect.anything(), "tch-1");
    // Denied before any booking-creation step: the flow never advanced past the
    // gate to availability lookup or the bookings insert (both come after it).
    expect(admin.from).not.toHaveBeenCalledWith("teacher_availability");
    expect(admin.from).not.toHaveBeenCalledWith("availability_exceptions");
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

  it("usePrepaidHours with a non-60-minute duration: rejects duration_min server-side", async () => {
    await expect(
      createBooking(baseInput({ usePrepaidHours: true, durationMin: 45 })),
    ).rejects.toMatchObject({ field: "duration_min" });
  });

  it("usePrepaidHours + no active package: uses the prepaid-specific message", async () => {
    vi.mocked(selectActivePackage).mockResolvedValue(null as never);
    vi.mocked(createAdminClient).mockReturnValue(makeAdmin({}) as never);
    await expect(
      createBooking(baseInput({ usePrepaidHours: true })),
    ).rejects.toMatchObject({
      field: "student_package",
      message: "لا يوجد رصيد ساعات كافٍ — اختر باقتك أو اشترِ ساعات",
    });
  });

  it("pending-count check errors: fails OPEN (logs, doesn't block) and continues validating", async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      makeAdmin({
        bookings: { updateError: { message: "count query failed" } },
        teacher_profiles: { data: null },
      }) as never,
    );
    await expect(createBooking(baseInput())).rejects.toMatchObject({
      field: "teacher_id",
    });
    expect(logError).toHaveBeenCalledWith(
      "createBooking: pending-count check failed — allowing",
      expect.anything(),
      expect.anything(),
    );
  });

  it("pendingCount >= the per-student cap: rejects before any teacher lookup", async () => {
    const admin = makeAdmin({ bookings: { count: 10 } });
    vi.mocked(createAdminClient).mockReturnValue(admin as never);
    await expect(createBooking(baseInput())).rejects.toMatchObject({
      name: "BookingValidationError",
      field: "student_package",
    });
    expect(admin.from).not.toHaveBeenCalledWith("teacher_profiles");
  });

  it("teacher_availability has slots but the requested time fits none of them", async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      makeAdmin({
        teacher_profiles: { data: { hourly_rate: 10, specialties: ["memorization"] } },
        teacher_availability: {
          data: [{ start_time: "09:00", end_time: "10:00", slot_duration: 60 }],
        },
      }) as never,
    );
    await expect(
      createBooking(baseInput({ localTime: "23:00" })),
    ).rejects.toMatchObject({ field: "scheduled_at" });
  });

  it("matching slot found but the requested duration exceeds it", async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      makeAdmin({
        teacher_profiles: { data: { hourly_rate: 10, specialties: ["memorization"] } },
        teacher_availability: {
          data: [{ start_time: "09:00", end_time: "11:00", slot_duration: 30 }],
        },
      }) as never,
    );
    await expect(
      createBooking(baseInput({ localTime: "10:00", durationMin: 60 })),
    ).rejects.toMatchObject({ field: "duration_min" });
  });

  it("availability_exceptions blocks the whole date", async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      makeAdmin({
        teacher_profiles: { data: { hourly_rate: 10, specialties: ["memorization"] } },
        teacher_availability: { data: [] },
        availability_exceptions: {
          data: [{ is_blocked: true, start_time: null, end_time: null }],
        },
      }) as never,
    );
    await expect(createBooking(baseInput())).rejects.toMatchObject({
      field: "scheduled_at",
    });
  });

  it("insert fails with a non-overlap DB error: logs and throws the generic Arabic error", async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      makeAdmin({
        teacher_profiles: { data: { hourly_rate: 10, specialties: ["memorization"] } },
        teacher_availability: { data: [] },
        availability_exceptions: { data: [] },
        bookings: { data: null, error: { message: "constraint violation: unrelated" } },
      }) as never,
    );
    await expect(createBooking(baseInput())).rejects.toThrow(
      "حدث خطأ أثناء إنشاء الحجز",
    );
    expect(logError).toHaveBeenCalledWith(
      "createBooking insert failed",
      expect.anything(),
      expect.anything(),
    );
  });

  it("insert succeeds but returns no id: throws the defensive error", async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      makeAdmin({
        teacher_profiles: { data: { hourly_rate: 10, specialties: ["memorization"] } },
        teacher_availability: { data: [] },
        availability_exceptions: { data: [] },
        bookings: { data: { id: null } },
      }) as never,
    );
    await expect(createBooking(baseInput())).rejects.toThrow(
      "لم يتم إنشاء الحجز",
    );
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

  it("concurrent cancel: loses the conditional-UPDATE race → alreadyInTargetState, no audit write", async () => {
    // Pre-read observes a non-cancelled (pending) row — same as the winning
    // caller would see. The conditional UPDATE (`.neq("status", newStatus)`)
    // returns 0 rows because a concurrent request already won the race and
    // flipped the row first. The re-read then reports the current row.
    const admin = makeAdmin({
      bookings: {
        data: { id: "b-1", status: "pending", student_id: "s-1", teacher_id: "t-1" },
        updateRows: [],
      },
    });
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const res = await updateBookingStatus({
      bookingId: "b-1",
      newStatus: "cancelled",
      actorId: "a-1",
    });

    expect(res.alreadyInTargetState).toBe(true);
    expect(res.oldStatus).toBe("pending");
    // Loser of the race writes nothing — no audit_log insert.
    expect(admin.from).not.toHaveBeenCalledWith("audit_log");
  });

  it("throws BookingStatusUpdateError when the conditional UPDATE itself errors", async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      makeAdmin({
        bookings: {
          data: { id: "b-1", status: "pending", student_id: "s-1", teacher_id: "t-1" },
          updateError: { message: "db down" },
        },
      }) as never,
    );
    await expect(
      updateBookingStatus({ bookingId: "b-1", newStatus: "confirmed", actorId: "a-1" }),
    ).rejects.toBeInstanceOf(BookingStatusUpdateError);
  });

  it("loses the race AND the row is gone on re-read: throws BookingNotFoundError", async () => {
    // Pre-read sees a live (pending) row; the conditional UPDATE returns 0
    // rows (lost the race); by the time we re-read, the row itself is gone
    // — surfaces as not-found rather than a fabricated alreadyInTargetState.
    vi.mocked(createAdminClient).mockReturnValue(
      makeAdmin({
        bookings: {
          singleSequence: [
            { data: { id: "b-1", status: "pending", student_id: "s-1", teacher_id: "t-1" } },
            { data: null },
          ],
          updateRows: [],
        },
      }) as never,
    );
    await expect(
      updateBookingStatus({ bookingId: "b-1", newStatus: "cancelled", actorId: "a-1" }),
    ).rejects.toBeInstanceOf(BookingNotFoundError);
  });

  it("winning transition without an explicit reason: audit INSERT failure is logged, not thrown", async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      makeAdmin({
        bookings: {
          data: { id: "b-1", status: "pending", student_id: "s-1", teacher_id: "t-1" },
        },
        audit_log: { updateError: { message: "audit insert failed" } },
      }) as never,
    );
    const res = await updateBookingStatus({
      bookingId: "b-1",
      newStatus: "confirmed",
      actorId: "a-1",
    });
    expect(res.alreadyInTargetState).toBe(false);
    expect(logError).toHaveBeenCalledWith(
      "updateBookingStatus: audit row INSERT failed",
      expect.anything(),
      expect.anything(),
    );
  });
});
