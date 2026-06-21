import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase.generated";
import type { TableInsert } from "@/lib/supabase/typed-helpers";
import { getMyAssignment } from "./assignments";
import { lockSlot, unlockSlot } from "./availability";
import { emitEvent } from "@/lib/automation/emit";
import { logError } from "@/lib/logger";

/**
 * Spec 020 — Scheduling (US1 / T009).
 *
 * Domain layer for constrained bookings.
 */

export class AssignmentNotFoundError extends Error {
  constructor() {
    super("No active teacher assignment found for this month.");
    this.name = "AssignmentNotFoundError";
  }
}

export class TeacherMismatchError extends Error {
  constructor() {
    super("You can only book slots with your assigned teacher.");
    this.name = "TeacherMismatchError";
  }
}

export class SlotAlreadyBookedError extends Error {
  constructor() {
    super("This slot is already booked. Please pick another.");
    this.name = "SlotAlreadyBookedError";
  }
}

export class SlotInstanceNotFoundError extends Error {
  constructor() {
    super("Slot instance not found.");
    this.name = "SlotInstanceNotFoundError";
  }
}

/**
 * Create a booking constrained to the student's assigned teacher.
 *
 * 1. Verifies student has an active assignment.
 * 2. Verifies the slot's teacher matches the assigned teacher.
 * 3. Locks the dated slot instance (atomic).
 * 4. Inserts the booking row with `scheduled_at` derived from the locked
 *    slot instance (slot_date + start_time), NOT from client input —
 *    closes the authz gap where a client could book one slot but write
 *    an arbitrary `scheduled_at` to the bookings row.
 */
export async function createConstrainedBooking(
  supabase: SupabaseClient<Database>,
  admin: SupabaseClient<Database>,
  userId: string,
  slotInstanceId: string,
): Promise<string> {
  // 1. Get active assignment
  const assignment = await getMyAssignment(supabase, userId);
  if (!assignment) {
    throw new AssignmentNotFoundError();
  }

  // 2. Get slot instance details. Fetch the canonical slot_date +
  //    start_time so `scheduled_at` is derived from the locked row, not
  //    from client input. Slot times are stored as `time` (no tz) and
  //    bookings.scheduled_at is timestamptz (UTC); we treat slot time as
  //    UTC, which matches the existing storage convention.
  const { data: slot, error: slotErr } = await admin
    .from("teacher_availability_instances")
    .select("teacher_id, is_booked, slot_date, start_time")
    .eq("id", slotInstanceId)
    .single();

  if (slotErr || !slot) {
    throw new SlotInstanceNotFoundError();
  }

  if (slot.teacher_id !== assignment.teacher_id) {
    throw new TeacherMismatchError();
  }

  if (slot.is_booked) {
    throw new SlotAlreadyBookedError();
  }

  // Derive canonical scheduled_at from the slot row. ISO 8601 UTC.
  const scheduledAt = `${slot.slot_date}T${slot.start_time}Z`;

  // 3. Atomic lock on dated instance
  const locked = await lockSlot(admin, slotInstanceId);
  if (!locked) {
    throw new SlotAlreadyBookedError();
  }

  // Resolve the session length from the student's subscription plan
  // (`subscription_plans.session_duration_min`). Falls back to 60 when the
  // plan or column is absent, preserving the previous hardcoded default.
  const { data: subRow, error: subErr } = await admin
    .from("subscriptions")
    .select("subscription_plans!inner(session_duration_min)")
    .eq("id", assignment.subscription_id)
    .maybeSingle();
  if (subErr) {
    logError("createConstrainedBooking: plan duration lookup failed (defaulting to 60)", subErr, {
      tag: "scheduling",
      student_id: userId,
    });
  }
  const planRel = subRow?.subscription_plans;
  const plan = Array.isArray(planRel) ? planRel[0] : planRel;
  const durationMin = plan?.session_duration_min ?? 60;

  // 4. Insert booking
  // Note: student_package_id resolution and debit is owned by the existing kernel
  // (confirm_booking_with_session). This route only creates the reservation.
  const { data: booking, error: bookErr } = await supabase
    .from("bookings")
    .insert({
      student_id: userId,
      teacher_id: slot.teacher_id,
      scheduled_at: scheduledAt,
      status: "pending",
      duration_min: durationMin,
      amount_usd: 0,
      rate_snapshot: 0,
    } satisfies TableInsert<"bookings">)
    .select("id")
    .single();

  if (bookErr) {
    // Best-effort rollback: release the slot lock so it doesn't stay orphaned.
    unlockSlot(admin, slotInstanceId).catch((unlockErr) =>
      logError("createConstrainedBooking: slot unlock failed", unlockErr, {
        slot_id: slotInstanceId,
      })
    );
    throw bookErr;
  }

  // Emit booking.created event (FR-021)
  emitEvent("booking.created", "booking", booking.id, {
    student_id: userId,
    teacher_id: slot.teacher_id,
    scheduled_at: scheduledAt,
  }).catch((err) => logError("emit booking.created failed", err, { tag: "automation" }));

  return booking.id;
}
