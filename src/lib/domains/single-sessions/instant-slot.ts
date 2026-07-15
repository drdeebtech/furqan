/**
 * Fail-closed, fail-before-charge instant-slot validation (principle 11).
 *
 * Timezone contract (mirrors the subscription flow, booking/actions.ts):
 * `teacher_availability` / `availability_exceptions` store app-local
 * wall-clock strings, so ALL availability comparisons use the CLIENT-provided
 * wall-clock fields (`dayOfWeek`/`localDate`/`localTime`). The absolute
 * instant `scheduledAt` is used ONLY for past/overlap checks. Never re-derive
 * wall-clock from `scheduledAt` on the server — the server tz (Vercel = UTC)
 * differs from the student's, shifting every comparison.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase.generated";
import { fitsAnySlot, isBlockedByException } from "../booking/validation";

export type InstantSlotRejection =
  | "past"
  | "unavailable"
  | "blocked"
  | "overlap"
  | "lookup_failed";

export type InstantSlotResult =
  | { ok: true }
  | { ok: false; reason: InstantSlotRejection };

export async function validateInstantSlot(
  admin: SupabaseClient<Database>,
  args: {
    teacherId: string;
    /** Absolute instant (UTC) — past/overlap checks only. */
    scheduledAt: Date;
    /** Student-local weekday (0–6) of the slot — availability lookup. */
    dayOfWeek: number;
    /** Student-local "YYYY-MM-DD" of the slot — exception-date lookup. */
    localDate: string;
    /** Student-local "HH:MM" of the slot — window/exception comparison. */
    localTime: string;
    durationMin: number;
    now?: Date;
  },
): Promise<InstantSlotResult> {
  const now = args.now ?? new Date();
  if (args.scheduledAt.getTime() <= now.getTime()) {
    return { ok: false, reason: "past" };
  }

  const { data: availability, error: availabilityError } = await admin
    .from("teacher_availability")
    .select("start_time, end_time, slot_duration")
    .eq("teacher_id", args.teacherId)
    .eq("day_of_week", args.dayOfWeek)
    .eq("is_active", true)
    .returns<{ start_time: string; end_time: string; slot_duration: number }[]>();
  if (availabilityError) return { ok: false, reason: "lookup_failed" };
  if (!fitsAnySlot(args.localTime, availability ?? [])) {
    return { ok: false, reason: "unavailable" };
  }

  const { data: exceptions, error: exceptionsError } = await admin
    .from("availability_exceptions")
    .select("is_blocked, start_time, end_time")
    .eq("teacher_id", args.teacherId)
    .eq("date", args.localDate)
    .returns<
      { is_blocked: boolean; start_time: string | null; end_time: string | null }[]
    >();
  if (exceptionsError) return { ok: false, reason: "lookup_failed" };
  if (isBlockedByException(args.localTime, exceptions ?? [])) {
    return { ok: false, reason: "blocked" };
  }

  // Overlap window: a booking can only overlap the slot if it starts before
  // the slot ends and within MAX_BOOKING_MS before the slot starts — bound the
  // query instead of scanning the teacher's full historical backlog.
  const MAX_BOOKING_MS = 24 * 60 * 60 * 1000;
  const windowStartIso = new Date(
    args.scheduledAt.getTime() - MAX_BOOKING_MS,
  ).toISOString();
  const windowEndIso = new Date(
    args.scheduledAt.getTime() + args.durationMin * 60000,
  ).toISOString();
  const { data: bookings, error: bookingsError } = await admin
    .from("bookings")
    .select("scheduled_at, duration_min")
    .eq("teacher_id", args.teacherId)
    .in("status", ["pending", "confirmed"])
    .not("scheduled_at", "is", null)
    .gte("scheduled_at", windowStartIso)
    .lt("scheduled_at", windowEndIso)
    .returns<{ scheduled_at: string | null; duration_min: number | null }[]>();
  if (bookingsError) return { ok: false, reason: "lookup_failed" };

  const targetStart = args.scheduledAt.getTime();
  const targetEnd = targetStart + args.durationMin * 60000;
  const overlaps = (bookings ?? []).some((booking) => {
    if (!booking.scheduled_at) return false;
    const start = new Date(booking.scheduled_at).getTime();
    const end = start + (booking.duration_min ?? 0) * 60000;
    return start < targetEnd && targetStart < end;
  });
  if (overlaps) return { ok: false, reason: "overlap" };

  return { ok: true };
}
