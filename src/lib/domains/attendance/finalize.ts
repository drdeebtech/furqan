import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase.generated";

/**
 * Spec 021 — Attendance, Excuses & Teacher Payroll.
 *
 * Domain layer. All money/credit mutations go through the SECURITY DEFINER
 * RPCs (finalize_attendance, run_monthly_payroll) on a service-role client;
 * this module is a thin typed wrapper that maps DB errors to typed results.
 */

export type AttendanceOutcome =
  | "present"
  | "student_absent"
  | "teacher_absent"
  | "excused_carried";

export type CreditAction = "none" | "debited" | "restored";

export class BookingNotFoundError extends Error {
  constructor() {
    super("Booking not found.");
    this.name = "BookingNotFoundError";
  }
}

export class FinalizeAttendanceError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "FinalizeAttendanceError";
    this.code = code;
  }
}

/**
 * Finalize a session outcome atomically via the `finalize_attendance` RPC.
 * Idempotent: re-calls with the same booking/outcome no-op on credit and
 * extension (see migration 20260619000004 for the on-conflict guards).
 */
export async function finalizeAttendance(
  admin: SupabaseClient<Database>,
  bookingId: string,
  outcome: AttendanceOutcome,
  actualTeacherId?: string,
): Promise<void> {
  const { error } = await admin.rpc("finalize_attendance", {
    p_booking_id: bookingId,
    p_outcome: outcome,
    p_actual_teacher_id: actualTeacherId,
  });

  if (error) {
    if (error.code === "P0002") throw new BookingNotFoundError();
    throw new FinalizeAttendanceError(error.message, error.code);
  }
}

/**
 * Compute the effective period end for a subscription: Stripe mirror
 * `current_period_end` + SUM(extension_seconds) from subscription_extensions.
 * Returns null if the subscription has no current_period_end (e.g. lifetime).
 *
 * COALESCE on the extension sum is essential: SUM over an empty join returns
 * NULL, and timestamptz + NULL interval = NULL — a subscription with no
 * extensions would silently lose its period end.
 */
export async function computeEffectiveEndDate(
  admin: SupabaseClient<Database>,
  subscriptionId: string,
): Promise<string | null> {
  const { data, error } = await admin
    .from("subscriptions")
    .select("current_period_end")
    .eq("id", subscriptionId)
    .single();

  if (error) throw error;
  if (!data?.current_period_end) return null;

  const { data: ext, error: extErr } = await admin
    .from("subscription_extensions")
    .select("extension_seconds")
    .eq("subscription_id", subscriptionId);

  if (extErr) throw extErr;

  const totalSeconds = (ext ?? []).reduce((sum, r) => sum + (r.extension_seconds ?? 0), 0);
  return new Date(
    new Date(data.current_period_end).getTime() + totalSeconds * 1000,
  ).toISOString();
}
