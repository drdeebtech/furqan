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
