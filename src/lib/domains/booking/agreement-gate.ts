import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { isFeatureEnabled } from "@/lib/settings";
import { callRpc } from "@/lib/supabase/rpc";
import { logError } from "@/lib/logger";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Spec 040 FR-028/029 — Teacher Agreement acceptance gate, booking-path
 * precondition. A teacher may only accept a booking (which later mints an
 * earning entry) if they have accepted the current Teacher Agreement version,
 * or are inside their per-teacher grace window.
 *
 * DORMANT by default: the `teacher_agreement_gate_enabled` platform setting
 * is absent/`false` in production, so this returns `true` and never touches
 * the predicate — zero behaviour change until the owner enables it. Gating in
 * the app layer (not just inside the predicate, which also returns `true` when
 * disabled) means the fail-closed branch below can never deny a live booking
 * while the feature is off.
 *
 * When ENABLED, fails CLOSED: a `false` predicate, an rpc error, or an
 * unexpected non-`true` result all deny — a gate-check failure must never let
 * an unconsented earning through. Called with the admin (service-role) client
 * so the predicate's reads (teacher_agreement_acceptances, teacher_profiles)
 * aren't hidden by the caller's RLS.
 */
export async function teacherAgreementOk(
  admin: AdminClient,
  teacherId: string,
): Promise<boolean> {
  if (!(await isFeatureEnabled("teacher_agreement_gate_enabled"))) return true;

  // callRpc types the result against the hand-corrected `database.ts` (the
  // generated types the admin client uses don't yet carry this function).
  const { data, error } = await callRpc(admin, "teacher_agreement_gate_ok", {
    p_teacher_id: teacherId,
  });

  if (error) {
    logError("teacherAgreementOk: gate rpc failed — denying (fail-closed)", error, {
      tag: "booking",
      metadata: { teacherId },
    });
    return false;
  }

  return data === true;
}
