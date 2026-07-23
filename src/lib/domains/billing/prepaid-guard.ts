import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/logger";

/**
 * Shared prepaid-hours grant PRECONDITIONS — the tamper guard + ownership
 * check that were duplicated byte-for-byte across the two payment rails:
 * `handlePrepaidHoursGrant` (Stripe, webhook-handlers.ts) and
 * `grantPaypalPrepaidCapture` (PayPal, paypal/grant.ts). This extracts only
 * that shared logic; each adapter still does its OWN grant RPC call and
 * payments-audit write, unchanged.
 *
 * Deliberately does NOT own the grant RPC or the audit tail — their failure
 * disposition diverges by design: Stripe throws WebhookTransientError on an
 * RPC/audit failure (forces a webhook retry, audit failure is fatal);
 * PayPal returns {ok:false} on RPC failure (the route maps that to a
 * retryable response) and treats its audit write as best-effort/non-fatal.
 * A "provider-neutral" fn owning both would have to smuggle that divergence
 * back in as flags — that's the premature abstraction this stays clear of.
 */

type AdminClient = ReturnType<typeof createAdminClient>;

export interface AssertPrepaidGrantValidArgs {
  studentId: string;
  hours: number;
  rate: number;
  /** What was actually charged, in cents (Stripe's amount_received, or
   *  Math.round(paypal amountUsd * 100)). */
  chargedCents: number;
}

export type AssertPrepaidGrantValidResult =
  | { ok: true }
  | { ok: false; reason: string };

export async function assertPrepaidGrantValid(
  admin: AdminClient,
  args: AssertPrepaidGrantValidArgs,
): Promise<AssertPrepaidGrantValidResult> {
  const { studentId, hours, rate, chargedCents } = args;

  // TAMPER GUARD — charged cents must equal hours × rate × 100, rounded.
  // Runs BEFORE the ownership lookup and BEFORE any grant RPC: a buyer who
  // tampers the amount between checkout and capture/confirmation must never
  // reach the grant, regardless of whose profile they claim to be.
  const expectedCents = Math.round(hours * rate * 100);
  if (chargedCents !== expectedCents) {
    return {
      ok: false,
      reason: `amount mismatch: expected ${expectedCents}, received ${chargedCents}`,
    };
  }

  // OWNERSHIP — student_id must resolve to a real profile with role
  // 'student'. The id was stamped at checkout by OUR route and is
  // signature-verified by the provider, so a bogus id here means a deleted
  // account or a misconfiguration — fail-closed either way. Never
  // auto-create accounts.
  const { data: profile, error: profileErr } = await admin
    .from("profiles")
    .select("id, role")
    .eq("id", studentId)
    .maybeSingle<{ id: string; role: string | null }>();
  if (profileErr) {
    logError("assertPrepaidGrantValid: profile lookup failed", profileErr, {
      tag: "prepaid-grant-guard",
      student_id: studentId,
    });
    return { ok: false, reason: "profile lookup failed" };
  }
  if (!profile) {
    return { ok: false, reason: `no profile for student_id ${studentId} — cannot grant` };
  }
  if (profile.role !== "student") {
    return { ok: false, reason: `student_id ${studentId} role is ${profile.role}, not student` };
  }

  return { ok: true };
}
