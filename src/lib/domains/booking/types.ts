/**
 * Booking domain — types & error classes.
 *
 * Per ADR-0002:
 * - Domain functions take **structured input**, not FormData.
 * - Domain functions **throw** on failure (route adapter catches).
 * - Errors are domain-meaningful subclasses so route adapters can map
 *   them to user-facing messages without inspecting message strings.
 */

import type { BookingStatus, SessionType } from "@/types/database";

/**
 * Structured input for `createBooking`. The route adapter parses
 * FormData + does auth, then hands a fully-typed input to the domain.
 *
 * `scheduledAt` is a `Date` (not a string) so the domain doesn't have to
 * worry about parse failures — the adapter validates the date+time
 * combine-ability before calling.
 */
export interface CreateBookingInput {
  studentId: string;
  teacherId: string;
  sessionType: SessionType;
  durationMin: number;
  scheduledAt: Date;
  /** Student's local calendar date "YYYY-MM-DD" — used for availability/exception matching. */
  localDate: string;
  /** Student's local clock time "HH:MM" — used for availability/exception matching. */
  localTime: string;
  notes: string | null;
}

/**
 * Result of a successful `createBooking`. The new row's id plus the
 * derived fields the route adapter needs for the cross-domain fan-out
 * (`scheduledAt` for the notification body, `amountUsd` if the route
 * later wants to surface it to the form, `rateSnapshot` for parity with
 * the legacy code).
 */
export interface CreateBookingResult {
  id: string;
  scheduledAt: string; // ISO 8601
  amountUsd: number;
  rateSnapshot: number;
}

/**
 * Thrown when the input fails domain validation (teacher unavailable,
 * session type unsupported, slot doesn't fit, blocked date, etc.).
 * Carries the offending field name so route adapters can surface a
 * field-specific error if the form supports it.
 */
export class BookingValidationError extends Error {
  constructor(
    public readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = "BookingValidationError";
  }
}

/**
 * Thrown when the booking insert fails because the time slot is already
 * taken (Postgres exclusion constraint `no_booking_overlap` fires).
 * Distinct from `BookingValidationError` so the route adapter can map
 * it to the specific "this time is taken — pick another" UX.
 */
export class BookingConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BookingConflictError";
  }
}

/**
 * Structured input for `updateBookingStatus`. Includes `actorId` so the
 * domain can write the audit row without re-doing the auth lookup the
 * route adapter already performed.
 *
 * `reason` is optional; when supplied (e.g., bulk action context), it
 * lands in the audit `new_data.reason` and `reason` columns. When omitted,
 * the audit reason defaults to `status set to <newStatus>`.
 */
export interface UpdateBookingStatusInput {
  bookingId: string;
  newStatus: BookingStatus;
  actorId: string;
  reason?: string;
}

/**
 * Result of `updateBookingStatus`. Includes the old status so the route
 * adapter can decide whether to emit an event (no-op on same-state stays
 * silent), plus `studentId`/`teacherId` for the event payload.
 *
 * `alreadyInTargetState` is `true` when the booking was already in
 * `newStatus` — the function returns without writing to bookings or
 * audit_log in that case (preserves existing bulk-actions behavior).
 */
export interface UpdateBookingStatusResult {
  id: string;
  oldStatus: BookingStatus | null;
  newStatus: BookingStatus;
  studentId: string;
  teacherId: string;
  alreadyInTargetState: boolean;
}

/**
 * Thrown when the booking row doesn't exist.
 */
export class BookingNotFoundError extends Error {
  constructor(public readonly bookingId: string) {
    super(`Booking ${bookingId} not found`);
    this.name = "BookingNotFoundError";
  }
}

/**
 * Thrown when the bookings UPDATE itself fails (DB error, constraint
 * violation other than overlap, etc.). Carries the underlying message
 * so callers can surface it; route adapters typically log + return a
 * generic user-facing error rather than echoing DB messages.
 */
export class BookingStatusUpdateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BookingStatusUpdateError";
  }
}

// ─── confirmBooking (use-case orchestrator) ─────────────────────────────────
//
// Per ADR-0004: the booking-confirm choreography (createRoom + sessions
// INSERT + notify + emitEvent) is bundled into a single domain orchestrator
// instead of being inlined at every route adapter. The orchestrator's
// critical path (bookings UPDATE + sessions INSERT) is atomic via the
// `confirm_booking_with_session(uuid, text, text, timestamptz)` Postgres
// function (migration 20260508011953). Side-effect calls (notify + emit)
// stay best-effort post-commit.

/**
 * Structured input for `confirmBooking`.
 *
 * The orchestrator does its own pre-read of the booking row to learn
 * `student_id`, `teacher_id`, `scheduled_at`, and `duration_min` — so
 * callers don't have to re-pass them. Only `bookingId` (the row to act
 * on) and `actorId` (for `emitEvent` actor field) are required.
 */
export interface ConfirmBookingInput {
  bookingId: string;
  actorId: string;
}

/**
 * Result of a successful `confirmBooking`. Returns enough for the route
 * adapter to surface the confirmed booking + new session in the UI
 * (roomUrl is consumed by the existing teacher dashboard optimistic
 * update — see `src/app/teacher/dashboard/booking-actions.tsx`).
 */
export interface ConfirmBookingResult {
  bookingId: string;
  sessionId: string;
  roomUrl: string;
  roomName: string;
  studentId: string;
  teacherId: string;
}

/**
 * Thrown when the booking is no longer in `pending` state at confirm
 * time. Two paths can produce this:
 *   - The orchestrator's pre-read sees `status !== 'pending'` (the common
 *     case — user double-clicked confirm, or admin and teacher raced).
 *   - The atomic SQL function `confirm_booking_with_session` raises
 *     `booking_not_pending` because someone transitioned the row
 *     between the pre-read and the UPDATE.
 *
 * Route adapters should surface this as a benign "booking already
 * processed" message, NOT a generic error.
 */
export class BookingAlreadyConfirmedError extends Error {
  constructor(public readonly bookingId: string) {
    super(`Booking ${bookingId} is not in pending state`);
    this.name = "BookingAlreadyConfirmedError";
  }
}

/**
 * Thrown when Daily.co `createRoom` fails BEFORE any DB write. Carries
 * the underlying API message for ops-side debugging; route adapters
 * translate to a generic Arabic user-facing error.
 *
 * This error means NOTHING was committed to Postgres — the booking
 * stays `pending`, no `sessions` row exists. The user can retry
 * without cleanup.
 */
export class BookingRoomCreationError extends Error {
  constructor(message: string) {
    super(`Daily.co room creation failed: ${message}`);
    this.name = "BookingRoomCreationError";
  }
}

/**
 * Thrown for unexpected DB errors during the atomic confirm path
 * (anything that's not `booking_not_pending`). Wrapped so route
 * adapters can `instanceof` instead of inspecting Supabase error
 * shapes.
 */
export class BookingConfirmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BookingConfirmError";
  }
}
