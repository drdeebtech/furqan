import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase.generated";
import { logError } from "@/lib/logger";

/**
 * Package ledger — the single seam for session-credit DEBIT from the
 * application side (Package domain, per CONTEXT.md).
 *
 * Before this module the soonest-expiry "which active package" SELECT and the
 * "deducted !== true means the package was expired/exhausted even though the
 * RPC succeeded — check data, not just error" rule (Spec 005 FR-002) were
 * copy-pasted across three call sites (group-session, class-offerings,
 * teacher instant-session). Each copy was a chance to drift.
 *
 * The underlying mutation lives in ONE place — the deduct_package_session(uuid)
 * Postgres kernel, which the 1:1 booking-confirm trigger now also delegates to
 * (migration 20260601164428). This module is the thin, typed facade over that
 * kernel for the explicit (non-trigger) debit paths.
 *
 * CREDIT is single-source via the restore_student_package() trigger and is not
 * exposed here.
 */

// The admin (service-role) client is required: students cannot read/charge
// other students' packages under RLS, and these debits run server-side on the
// caller's behalf. Callers pass their existing admin client so the debit shares
// their transaction context and audit metadata.
type AdminClient = SupabaseClient<Database>;

export interface ActivePackage {
  id: string;
  sessionsRemaining: number;
}

/**
 * The student's soonest-expiry active package that still has credit, or null
 * when they have none. Single definition of "which package gets charged" for
 * the explicit debit paths (the trigger applies the same ordering in SQL).
 */
export async function selectActivePackage(
  admin: AdminClient,
  studentId: string,
): Promise<ActivePackage | null> {
  const { data, error } = await admin
    .from("student_packages")
    .select("id, sessions_remaining")
    .eq("student_id", studentId)
    .eq("status", "active")
    .gt("sessions_remaining", 0)
    .order("expires_at", { ascending: true, nullsFirst: false })
    .limit(1)
    .maybeSingle<{ id: string; sessions_remaining: number }>();

  // No Silent Failures policy: a query error must surface in Sentry, not be
  // swallowed as "no active package". We still fail closed (return null → the
  // caller blocks the booking) but the operator sees the real cause.
  if (error) {
    logError("selectActivePackage query failed", error, {
      tag: "package-ledger",
      metadata: { studentId },
    });
    return null;
  }

  if (!data) return null;
  return { id: data.id, sessionsRemaining: data.sessions_remaining };
}

export type DebitOutcome =
  | { ok: true }
  | { ok: false; reason: "exhausted" }
  | { ok: false; reason: "error"; message: string };

/**
 * Debit one session credit from a specific package via the
 * deduct_package_session(uuid) kernel.
 *
 * Encapsulates the Spec 005 FR-002 rule once: the RPC returns NULL (not an
 * error) when the package's guard predicate failed — already expired or
 * exhausted between selection and debit — so a non-error result is NOT proof
 * the credit was taken. Callers branch on the returned DebitOutcome and map it
 * to their own UX; they never re-implement the data-vs-error check.
 */
export async function debitPackage(
  admin: AdminClient,
  packageId: string,
): Promise<DebitOutcome> {
  const { data, error } = await admin.rpc("deduct_package_session", {
    p_package_id: packageId,
  });

  if (error) return { ok: false, reason: "error", message: error.message };
  if (data !== true) return { ok: false, reason: "exhausted" };
  return { ok: true };
}
