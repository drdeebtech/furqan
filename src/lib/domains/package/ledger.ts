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
 * The student's active package that should be charged next, or null when they
 * have none. Single definition of "which package gets charged" for the explicit
 * debit paths (the confirm-time trigger applies the same ordering in SQL).
 *
 * R2 ranking (spec 038): subscription packages rank AHEAD of prepaid_hours,
 * then soonest-expiry. A student holding both a subscription with credit and a
 * wallet is NEVER silently drained of a wallet hour — the subscription is
 * charged first. Wallet-only and subscription-only students see unchanged
 * selection (within a single product_type the soonest-expiry order is the same
 * as before).
 *
 * Pass `{ usePrepaidHours: true }` for the explicit "use my hours" override
 * (R2): restricts the candidate set to prepaid_hours lots and picks the
 * soonest-expiry one. The caller then stamps the chosen id onto the booking so
 * the confirm-time trigger's early-return guard (`student_package_id IS NOT
 * NULL`) honors the explicit choice instead of re-applying the default ranking.
 */
export async function selectActivePackage(
  admin: AdminClient,
  studentId: string,
  options?: { usePrepaidHours?: boolean },
): Promise<ActivePackage | null> {
  let query = admin
    .from("student_packages")
    .select("id, sessions_remaining, subscription_id, subscriptions(status)")
    .eq("student_id", studentId)
    .eq("status", "active")
    .gt("sessions_remaining", 0);

  if (options?.usePrepaidHours) {
    // R2 override — wallet lots only. Wallet hours are spendable on individual
    // 1:1 sessions only (D2/R7); the booking flow gates this upstream.
    query = query.eq("product_type", "prepaid_hours");
  } else {
    // R2 default — subscription ahead of prepaid_hours. Mirrors the confirm-time
    // trigger's `ORDER BY (product_type='prepaid_hours') ASC` exactly. ASC on
    // the boolean would be ideal, but postgrest-js exposes column ordering, not
    // expression ordering; lexicographic DESC on the text achieves the same
    // total order because 'subscription' > 'prepaid_hours' alphabetically.
    query = query.order("product_type", { ascending: false });
  }

  query = query
    .order("expires_at", { ascending: true, nullsFirst: false })
    .limit(1);

  const { data, error } = await query.maybeSingle<{
    id: string;
    sessions_remaining: number;
    subscription_id: string | null;
    subscriptions: { status: string } | { status: string }[] | null;
  }>();

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

  // Fix #6 — past-due booking gate. A subscription grant is chargeable only
  // while its subscription is active. The confirm-time deduct trigger charges
  // subscription-first WITHOUT a status check, so letting a booking through when
  // the top candidate is a past_due / unpaid subscription grant would drain that
  // frozen subscription's sessions. Deny by default. Prepaid_hours / single-
  // session lots carry no subscription_id and are never blocked; a student with
  // wallet hours can still book via the explicit "use my hours" path (which
  // restricts the candidate set to prepaid lots).
  if (data.subscription_id) {
    const sub = data.subscriptions;
    const status = Array.isArray(sub) ? sub[0]?.status : sub?.status;
    if (status !== "active") return null;
  }

  return { id: data.id, sessionsRemaining: data.sessions_remaining };
}

/**
 * Does this student hold a credit they could actually spend on a 1:1 booking?
 *
 * UI-AFFORDANCE PREDICATE ONLY — it grants nothing and charges nothing. Its job
 * is to make the "Book" button appear exactly when `createBooking`'s fail-closed
 * package precondition would let the booking through, so the student is never
 * offered a button that leads to a dead end, nor hidden a button they have paid
 * for. The authoritative guards are unchanged: `createBooking` at create time
 * and the `deduct_student_package` trigger at confirm time.
 *
 * Mirrors `selectActivePackage`'s candidate rules deliberately (active lot with
 * remaining credit; a subscription-funded lot counts only while its subscription
 * is active). It intentionally does NOT apply the R2 *ranking* — ranking picks
 * WHICH lot pays, which is irrelevant to "is there any".
 *
 * Takes the caller's RLS-scoped client rather than a service-role one: the
 * `student_read_own_packages` and `subscriptions_read_own_or_admin` policies
 * already let a student read exactly their own rows, so a self-check needs no
 * elevated privilege (least privilege).
 *
 * Fails OPEN (returns true) on a query error. This is a display decision, not a
 * money decision: on a transient DB blip a paying student must not be shown a
 * paywall, and the worst case for a non-paying one is reaching the booking form
 * and getting createBooking's precise "no active package" message instead of
 * the paywall. No credit can be spent on a false positive.
 */
export async function hasBookableCredit(
  client: SupabaseClient<Database>,
  studentId: string,
): Promise<boolean> {
  const { data, error } = await client
    .from("student_packages")
    .select("id, subscription_id, subscriptions(status)")
    .eq("student_id", studentId)
    .eq("status", "active")
    .gt("sessions_remaining", 0)
    .returns<
      {
        id: string;
        subscription_id: string | null;
        subscriptions: { status: string } | { status: string }[] | null;
      }[]
    >();

  if (error) {
    logError("hasBookableCredit query failed — showing the booking affordance", error, {
      tag: "package-ledger",
      metadata: { studentId },
    });
    return true;
  }

  return (data ?? []).some((lot) => {
    // Prepaid-hours / single-session lots carry no subscription_id and are
    // always spendable while active.
    if (!lot.subscription_id) return true;
    const sub = lot.subscriptions;
    const status = Array.isArray(sub) ? sub[0]?.status : sub?.status;
    return status === "active";
  });
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
