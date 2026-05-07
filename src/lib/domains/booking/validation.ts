/**
 * Booking domain — pure validation helpers.
 *
 * Per ADR-0002 §"Out of scope": pure-function pieces of the domain
 * (validation, mappers) live in colocated *.test.ts files. This module
 * extracts the comparison/arithmetic logic out of `actions.ts` so it
 * can be unit-tested without the `server-only` import barrier or the
 * Supabase mock setup.
 *
 * Each helper is a pure function over plain values — no I/O, no Date
 * mutation, no module-level state. Caller passes everything in.
 */

/**
 * A weekly availability slot from `teacher_availability`. `start_time`
 * and `end_time` are Postgres `time` columns serialized as strings
 * like "09:00:00" or "13:30:00". The HH:MM prefix is what gets compared.
 */
export interface AvailabilitySlot {
  start_time: string;
  end_time: string;
  slot_duration: number;
}

/**
 * A date-specific exception from `availability_exceptions`. When
 * `is_blocked=true` and both times are null, the entire date is blocked.
 * When `is_blocked=true` and both times are present, only the time
 * range is blocked. `is_blocked=false` rows are non-blocking exceptions
 * (could be additional availability — not modeled here).
 */
export interface AvailabilityException {
  is_blocked: boolean;
  start_time: string | null;
  end_time: string | null;
}

/**
 * Returns the slot that contains the given time, or undefined.
 *
 * Comparison uses string slicing on "HH:MM" — Postgres time strings
 * sort lexicographically the same way as their numeric values within
 * a single day, which is the only range we ever compare here.
 *
 * Half-open interval: `start_time <= time < end_time`. Matches the
 * original inline logic in createBooking.
 */
export function findSlotContaining(
  timeHHMM: string,
  slots: readonly AvailabilitySlot[],
): AvailabilitySlot | undefined {
  return slots.find(
    (s) =>
      timeHHMM >= s.start_time.slice(0, 5) &&
      timeHHMM < s.end_time.slice(0, 5),
  );
}

/**
 * True if any slot covers the given time.
 */
export function fitsAnySlot(
  timeHHMM: string,
  slots: readonly AvailabilitySlot[],
): boolean {
  return findSlotContaining(timeHHMM, slots) !== undefined;
}

/**
 * True if the given time is blocked by any of the supplied exceptions.
 *
 * - Full-day block: `is_blocked=true` with both times null.
 * - Time-range block: `is_blocked=true` with both times present;
 *   half-open interval `[start, end)`.
 * - All other shapes are treated as non-blocking (defensive — current
 *   schema doesn't allow `is_blocked=true` with only one time set, but
 *   the helper is robust to it).
 */
export function isBlockedByException(
  timeHHMM: string,
  exceptions: readonly AvailabilityException[],
): boolean {
  return exceptions.some((ex) => {
    if (!ex.is_blocked) return false;
    if (!ex.start_time && !ex.end_time) return true;
    if (ex.start_time && ex.end_time) {
      return (
        timeHHMM >= ex.start_time.slice(0, 5) &&
        timeHHMM < ex.end_time.slice(0, 5)
      );
    }
    return false;
  });
}

/**
 * Computes the booking amount in USD from the teacher's hourly rate
 * snapshot and the booked duration in minutes. Rounded to two decimals
 * to match the `bookings.amount_usd numeric(10,2)` column.
 */
export function computeAmountUsd(
  rateSnapshot: number,
  durationMin: number,
): number {
  return Number((rateSnapshot * (durationMin / 60)).toFixed(2));
}

/**
 * True if `scheduledAt` is more than `windowMs` milliseconds in the
 * past relative to `now`. Used to enforce the 30-minute-past bound on
 * createBooking — `now` is parameterized so tests don't need to control
 * Date.now().
 */
export function isMoreThanWindowInPast(
  scheduledAt: Date,
  windowMs: number,
  now: Date = new Date(),
): boolean {
  return scheduledAt.getTime() < now.getTime() - windowMs;
}

/**
 * Extracts the "HH:MM" prefix from a Date's local time. Centralized
 * so the format used in slot/exception comparison stays in one place.
 */
export function timeToHHMM(d: Date): string {
  return d.toTimeString().slice(0, 5);
}

/**
 * Extracts "YYYY-MM-DD" from a Date's UTC ISO string. Matches the
 * `availability_exceptions.date date` column shape.
 */
export function dateToYYYYMMDD(d: Date): string {
  return d.toISOString().slice(0, 10);
}
