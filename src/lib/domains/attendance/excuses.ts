import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase.generated";
import { getSettings } from "@/lib/settings";
import { finalizeAttendance, type AttendanceOutcome } from "./finalize";

/**
 * Spec 021 — Excuse submission + teacher decision flow.
 *
 * Eligibility is computed at submission time from the
 * `excuse_notice_threshold_seconds` platform setting (default 7200s = 2h).
 * The deciding teacher must match the booking's assigned teacher; admins
 * can decide any. Accepting an eligible excuse triggers the carry-over
 * path (credit restore + subscription extension) via finalizeAttendance.
 */

export class ExcuseThresholdError extends Error {
  constructor() {
    super("Excuse submitted inside the notice threshold; not eligible.");
    this.name = "ExcuseThresholdError";
  }
}

export class ExcuseAlreadyDecidedError extends Error {
  constructor() {
    super("This excuse has already been decided.");
    this.name = "ExcuseAlreadyDecidedError";
  }
}

export class ExcuseNotEligibleError extends Error {
  constructor() {
    super("This excuse is not eligible for carry-over.");
    this.name = "ExcuseNotEligibleError";
  }
}

export class ExcuseAuthorizationError extends Error {
  constructor() {
    super("Only the assigned teacher or an admin can decide this excuse.");
    this.name = "ExcuseAuthorizationError";
  }
}

export interface SubmitExcuseInput {
  bookingId: string;
  reason: string;
  userId: string;
}

/**
 * Submit an excuse. Eligibility computed from threshold at submission time.
 * One excuse per booking (unique constraint surfaces as a typed error).
 */
export async function submitExcuse(
  supabase: SupabaseClient<Database>,
  input: SubmitExcuseInput,
): Promise<{ excuseId: string; isEligible: boolean }> {
  const { bookingId, reason, userId } = input;

  // Fetch the booking to get teacher_id + scheduled_at + student_id check.
  const { data: booking, error: bookErr } = await supabase
    .from("bookings")
    .select("student_id, teacher_id, scheduled_at")
    .eq("id", bookingId)
    .single();

  if (bookErr || !booking) {
    throw new Error("Booking not found.");
  }
  if (booking.student_id !== userId) {
    throw new Error("Not your booking.");
  }

  // Compute eligibility from platform setting.
  const settings = await getSettings();
  const thresholdSeconds = Number(
    settings.excuse_notice_threshold_seconds ?? "7200",
  );
  const scheduledAt = new Date(booking.scheduled_at).getTime();
  const now = Date.now();
  const isEligible = (scheduledAt - now) >= thresholdSeconds * 1000;

  const { data: excuse, error } = await supabase
    .from("excuse_requests")
    .insert({
      booking_id: bookingId,
      student_id: userId,
      teacher_id: booking.teacher_id,
      reason,
      is_eligible: isEligible,
      status: isEligible ? "pending" : "ineligible",
    })
    .select("id, is_eligible")
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new Error("An excuse already exists for this booking.");
    }
    throw error;
  }

  return { excuseId: excuse.id, isEligible: excuse.is_eligible };
}

export interface DecideExcuseInput {
  excuseId: string;
  decision: "accepted" | "rejected";
  deciderId: string;
  isAdmin: boolean;
}

/**
 * Decide an excuse. Only the assigned teacher (or an admin) can decide.
 * Accepting an eligible excuse triggers carry-over via finalizeAttendance.
 */
export async function decideExcuse(
  admin: SupabaseClient<Database>,
  input: DecideExcuseInput,
): Promise<{ carried: boolean }> {
  const { excuseId, decision, deciderId, isAdmin } = input;

  const { data: excuse, error: fetchErr } = await admin
    .from("excuse_requests")
    .select("id, booking_id, teacher_id, is_eligible, status")
    .eq("id", excuseId)
    .single();

  if (fetchErr || !excuse) {
    throw new Error("Excuse not found.");
  }

  if (!isAdmin && excuse.teacher_id !== deciderId) {
    throw new ExcuseAuthorizationError();
  }
  if (excuse.status !== "pending") {
    throw new ExcuseAlreadyDecidedError();
  }
  if (decision === "accepted" && !excuse.is_eligible) {
    throw new ExcuseNotEligibleError();
  }

  const { error: updErr } = await admin
    .from("excuse_requests")
    .update({
      status: decision,
      decided_by: deciderId,
      decided_at: new Date().toISOString(),
    })
    .eq("id", excuseId)
    .eq("status", "pending"); // optimistic guard against races

  if (updErr) throw updErr;

  if (decision === "accepted") {
    const outcome: AttendanceOutcome = "excused_carried";
    await finalizeAttendance(admin, excuse.booking_id, outcome);
    return { carried: true };
  }

  return { carried: false };
}
