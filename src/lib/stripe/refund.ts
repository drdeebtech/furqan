import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Session credit-back — called when a booking is cancelled with refund-eligible
 * policy, or a teacher no-show is confirmed. Reverses the deduct_package_session
 * RPC's effect by decrementing sessions_used on the student_package the booking
 * was charged against.
 *
 * Does NOT issue a monetary Stripe refund — that happens via the Stripe SDK in
 * the route handler. This function only restores session credit in our DB.
 */
export interface RefundInput {
  bookingId: string;
  reason: "student_cancel" | "teacher_no_show" | "admin_override" | "teacher_cancel";
  actorId: string | null;
}

export interface RefundResult {
  ok: boolean;
  restored?: boolean;
  error?: string;
}

export async function creditBackSession(input: RefundInput): Promise<RefundResult> {
  const supabase = createAdminClient();

  const { data: booking } = await supabase
    .from("bookings")
    .select("id, student_id, student_package_id, status")
    .eq("id", input.bookingId)
    .single<{ id: string; student_id: string; student_package_id: string | null; status: string }>();

  if (!booking) return { ok: false, error: "Booking not found" };
  if (!booking.student_package_id) return { ok: true, restored: false }; // Wasn't on a package — nothing to restore

  const { data: pkg } = await supabase
    .from("student_packages")
    .select("id, sessions_used")
    .eq("id", booking.student_package_id)
    .single<{ id: string; sessions_used: number }>();

  if (!pkg) return { ok: false, error: "Package not found" };

  const { error: updErr } = await supabase
    .from("student_packages")
    .update({ sessions_used: Math.max(0, pkg.sessions_used - 1) } as never)
    .eq("id", pkg.id);

  if (updErr) return { ok: false, error: updErr.message };

  // Audit trail via payment_transactions so the refund is visible in finance reports
  const { data: payment } = await supabase
    .from("payments")
    .select("id")
    .eq("student_id", booking.student_id)
    .eq("status", "succeeded")
    .order("paid_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (payment) {
    await supabase.from("payment_transactions").insert({
      payment_id: payment.id,
      type: "refund",
      amount_usd: 0, // Credit-back, not monetary
      description: `Session credit restored: ${input.reason} (booking ${booking.id})`,
    } as never);
  }

  return { ok: true, restored: true };
}
