/** Fail-closed, fail-before-charge instant-slot validation (principle 11). */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase.generated";
import {
  dateToYYYYMMDD,
  fitsAnySlot,
  isBlockedByException,
  timeToHHMM,
} from "../booking/validation";

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
  args: { teacherId: string; scheduledAt: Date; durationMin: number; now?: Date },
): Promise<InstantSlotResult> {
  const now = args.now ?? new Date();
  if (args.scheduledAt.getTime() <= now.getTime()) {
    return { ok: false, reason: "past" };
  }

  const { data: availability, error: availabilityError } = await admin
    .from("teacher_availability")
    .select("start_time, end_time, slot_duration")
    .eq("teacher_id", args.teacherId)
    .eq("day_of_week", args.scheduledAt.getDay())
    .eq("is_active", true)
    .returns<{ start_time: string; end_time: string; slot_duration: number }[]>();
  if (availabilityError) return { ok: false, reason: "lookup_failed" };
  if (!fitsAnySlot(timeToHHMM(args.scheduledAt), availability ?? [])) {
    return { ok: false, reason: "unavailable" };
  }

  const { data: exceptions, error: exceptionsError } = await admin
    .from("availability_exceptions")
    .select("is_blocked, start_time, end_time")
    .eq("teacher_id", args.teacherId)
    .eq("date", dateToYYYYMMDD(args.scheduledAt))
    .returns<
      { is_blocked: boolean; start_time: string | null; end_time: string | null }[]
    >();
  if (exceptionsError) return { ok: false, reason: "lookup_failed" };
  if (isBlockedByException(timeToHHMM(args.scheduledAt), exceptions ?? [])) {
    return { ok: false, reason: "blocked" };
  }

  const { data: bookings, error: bookingsError } = await admin
    .from("bookings")
    .select("scheduled_at, duration_min")
    .eq("teacher_id", args.teacherId)
    .in("status", ["pending", "confirmed"])
    .not("scheduled_at", "is", null)
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
