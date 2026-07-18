import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { callRpc } from "@/lib/supabase/rpc";
import { logError } from "@/lib/logger";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Spec 040 FR-028/029 — Teacher Agreement acceptance gate, booking-path
 * precondition. A teacher may only accept a booking (which later mints an
 * earning entry) if they have accepted the current Teacher Agreement version,
 * or are inside their per-teacher grace window.
 *
 * DORMANT by default — but dormancy lives INSIDE the predicate, which returns
 * `true` while `teacher_agreement_gate_enabled` is not `'true'`. We deliberately
 * do NOT gate on a separate app-layer `isFeatureEnabled()` read: that helper
 * collapses a settings-table outage to `false` ("disabled"), which would make
 * this function return `true` and silently BYPASS the consent gate exactly when
 * the flag is on but momentarily unreadable. The predicate reads the flag inside
 * one atomic DB call instead, so there is no app-layer fail-open seam.
 *
 * Fails CLOSED: a `false` predicate, a non-`true` result, or an rpc error all
 * deny — a consent-gate check must never fail open into an unconsented earning.
 * The ONE exception is a "function does not exist" error: the wiring and the
 * predicate migration ship in the same PR and deploy concurrently (no ordering
 * gate), so for a few seconds the build can be live before the function exists.
 * That is the deploy window, not a consent failure, so we allow it (the flag is
 * dormant anyway). Called with the admin (service-role) client so the
 * predicate's reads aren't hidden by the caller's RLS.
 */
export async function teacherAgreementOk(
  admin: AdminClient,
  teacherId: string,
): Promise<boolean> {
  // callRpc types the result against the hand-corrected `database.ts` (the
  // generated types the admin client uses don't yet carry this function).
  const { data, error } = await callRpc(admin, "teacher_agreement_gate_ok", {
    p_teacher_id: teacherId,
  });

  if (error) {
    // Deploy window only: the predicate isn't in the schema cache yet (PostgREST
    // PGRST202) / undefined_function (Postgres 42883). Not a consent failure —
    // the gate is dormant until the migration lands seconds later. Allow.
    if (error.code === "PGRST202" || error.code === "42883") return true;
    // Every other error fails CLOSED — never let an unconsented earning through.
    logError("teacherAgreementOk: gate rpc failed — denying (fail-closed)", error, {
      tag: "booking",
      metadata: { teacherId },
    });
    return false;
  }

  return data === true;
}
