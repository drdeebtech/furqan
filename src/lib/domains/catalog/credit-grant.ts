import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase.generated";
import { logError } from "@/lib/logger";

/**
 * Spec 019 — Credit Grant domain (US3 / T013).
 *
 * `grantHifzCycleCredits` wraps the `grant_hifz_cycle_credits` DB RPC.
 * Used for:
 *   - T014a: re-grant at renewal when applying a pending tier change
 *   - T022:  delta session grant on mid-month upgrade
 *
 * The normal monthly cycle grant flows through `grantCycle` / `grant_subscription_cycle`
 * (spec 018), which records payment + grant atomically.
 */

export interface GrantHifzResult {
  ok: true;
  grantId: string;
  created: boolean;
}

export interface GrantHifzFailure {
  ok: false;
  error: string;
}

/**
 * Invoke `grant_hifz_cycle_credits(...)` via RPC. Service-role client only.
 *
 * Returns `{ grantId, created }`. `created` is determined by checking whether a
 * `student_packages` row with this `(subscription_id, billing_cycle_key)` already
 * existed BEFORE the call — the RPC itself is idempotent, so this is informational.
 */
export async function grantHifzCycleCredits(
  admin: SupabaseClient<Database>,
  subscriptionId: string,
  planId: string,
  billingCycleKey: string,
  sessionCount?: number,
): Promise<GrantHifzResult | GrantHifzFailure> {
  try {
    const { data: prior } = await admin
      .from("student_packages")
      .select("id")
      .eq("subscription_id", subscriptionId)
      .eq("billing_cycle_key", billingCycleKey)
      .maybeSingle();
    const existedBefore = Boolean(prior);

    const { data, error } = await admin.rpc("grant_hifz_cycle_credits", {
      p_subscription_id: subscriptionId,
      p_plan_id: planId,
      p_billing_cycle_key: billingCycleKey,
      ...(sessionCount !== undefined ? { p_session_count: sessionCount } : {}),
    });

    if (error) {
      logError("catalog.grantHifzCycleCredits RPC failed", error, {
        tag: "billing",
        subscription_id: subscriptionId,
        plan_id: planId,
        cycle_key: billingCycleKey,
      });
      return { ok: false, error: error.message };
    }
    if (!data) {
      return { ok: false, error: "grant_hifz_cycle_credits returned no id" };
    }

    return {
      ok: true,
      grantId: data as string,
      created: !existedBefore,
    };
  } catch (err) {
    logError("catalog.grantHifzCycleCredits crashed", err, {
      tag: "billing",
      subscription_id: subscriptionId,
      cycle_key: billingCycleKey,
    });
    return { ok: false, error: err instanceof Error ? err.message : "grant crashed" };
  }
}

// ─── T014a: Pending tier change application ─────────────────────────────────

export interface PendingTierChangeRow {
  id: string;
  subscription_id: string;
  student_id: string;
  from_package_id: string;
  to_package_id: string;
  change_reason: string;
  status: string;
}

export interface AppliedTierChangeResult {
  ok: true;
  pendingId: string;
  newPlanId: string;
  regrant: GrantHifzResult | GrantHifzFailure;
}

export interface AppliedTierChangeFailure {
  ok: false;
  reason: "no_pending" | "lookup_failed" | "update_failed";
  error?: string;
}

/**
 * Apply a pending tier change at renewal (FR-019 / T014a).
 *
 * Steps (service-role only):
 * 1. Look up the subscription's pending `pending_tier_changes` row (at most one,
 *    guaranteed by partial unique index).
 * 2. Resolve the new plan from `to_package_id → packages.subscription_plan_id`.
 * 3. Re-grant credits at the NEW tier's `sessions_per_month` using a distinct
 *    billing_cycle_key (`{subscriptionId}:tier-change-{pendingId}`) so it is
 *    stable across monthly renewals and idempotent across webhook retries.
 * 4. Switch the subscription to the new plan.
 * 5. Transition `pending → applied` (WHERE status = 'pending' guard
 *    makes this replay-safe).
 *
 * Returns `{ ok: false, reason: 'no_pending' }` when there's nothing to apply
 * (the common case — most renewals have no pending change).
 */
export async function applyPendingTierChangeAtRenewal(
  admin: SupabaseClient<Database>,
  subscriptionId: string,
  invoiceId: string,
): Promise<AppliedTierChangeResult | AppliedTierChangeFailure> {
  // 1. Look up pending change (partial unique index → at most one).
  const { data: pending, error: lookupErr } = await admin
    .from("pending_tier_changes")
    .select("id, subscription_id, student_id, from_package_id, to_package_id, change_reason, status")
    .eq("subscription_id", subscriptionId)
    .eq("status", "pending")
    .maybeSingle<PendingTierChangeRow>();

  if (lookupErr) {
    logError("applyPendingTierChange: lookup failed", lookupErr, {
      tag: "billing", subscription_id: subscriptionId, invoice_id: invoiceId,
    });
    return { ok: false, reason: "lookup_failed", error: lookupErr.message };
  }

  // No pending change → normal renewal, nothing to do.
  if (!pending) {
    return { ok: false, reason: "no_pending" };
  }

  // 2. Resolve new plan_id from to_package_id.
  const { data: pkg } = await admin
    .from("packages")
    .select("subscription_plan_id")
    .eq("id", pending.to_package_id)
    .maybeSingle<{ subscription_plan_id: string | null }>();

  if (!pkg?.subscription_plan_id) {
    logError("applyPendingTierChange: to_package has no subscription_plan_id", new Error("missing plan"), {
      tag: "billing", subscription_id: subscriptionId, to_package_id: pending.to_package_id,
    });
    return { ok: false, reason: "lookup_failed", error: "to_package has no subscription_plan_id" };
  }

  const newPlanId = pkg.subscription_plan_id;

  // 3. Switch subscription.plan_id FIRST so the grant SQL validation passes.
  //    The grant function asserts s.plan_id = p_plan_id; subscription must already
  //    reflect the new plan before we call it.
  //    Partial-failure: if grant (step 4) fails after this update, subscription.plan_id
  //    is already newPlanId but credits haven't been issued. The webhook marks the event
  //    failed and Stripe retries; on retry applyPendingTierChangeAtRenewal runs again —
  //    pending is still 'pending', plan switch is a no-op, grant key is idempotent.
  const { data: updatedSub, error: subErr } = await admin
    .from("subscriptions")
    .update({ plan_id: newPlanId })
    .eq("id", subscriptionId)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (subErr || !updatedSub) {
    logError("applyPendingTierChange: subscription plan switch failed", subErr, {
      tag: "billing", subscription_id: subscriptionId, new_plan_id: newPlanId,
    });
    return { ok: false, reason: "update_failed", error: subErr?.message ?? "subscription update matched no rows" };
  }

  // 4. Re-grant at the new tier's sessions_per_month (idempotent via billing_cycle_key).
  //    Subscription-scoped key: stable across monthly renewals and webhook retries.
  //    An invoice-scoped key (invoiceId:tier-applied) would create duplicate grants
  //    if plan switch succeeds but grant fails → pending stays 'pending' → next
  //    month produces a new invoiceId and a second grant for the same tier change.
  const regrantKey = `${subscriptionId}:tier-change-${pending.id}`;
  const regrant = await grantHifzCycleCredits(admin, subscriptionId, newPlanId, regrantKey);

  if (!regrant.ok) {
    logError("applyPendingTierChange: credit regrant failed", new Error(regrant.error), {
      tag: "billing", subscription_id: subscriptionId, new_plan_id: newPlanId,
    });
    return { ok: false, reason: "update_failed", error: regrant.error };
  }

  // 5. Transition pending → applied only after regrant + sub switch both succeed
  //    (WHERE status = 'pending' = replay-safe).
  const { error: statusErr } = await admin
    .from("pending_tier_changes")
    .update({ status: "applied", applied_at: new Date().toISOString() })
    .eq("id", pending.id)
    .eq("status", "pending");

  if (statusErr) {
    logError("applyPendingTierChange: status transition failed", statusErr, {
      tag: "billing", subscription_id: subscriptionId, pending_id: pending.id,
    });
    return { ok: false, reason: "update_failed", error: statusErr.message };
  }

  return {
    ok: true,
    pendingId: pending.id,
    newPlanId,
    regrant,
  };
}

// ─── Immediate-upgrade grant, payment-gated (audit 2026-07-15) ───────────────

export interface PendingUpgradeGrantRow {
  id: string;
  subscription_id: string;
  student_id: string;
  plan_id: string;
  delta_sessions: number;
  stripe_invoice_id: string;
  status: string;
}

export interface RecordPendingUpgradeResult {
  ok: true;
  id: string;
}

/**
 * Record the delta grant for an immediate tier upgrade WITHOUT granting it.
 * Credits are granted by handleInvoicePaid when the proration invoice
 * (billing_reason = 'subscription_update') is confirmed paid — never before.
 * Idempotent on stripe_invoice_id (UNIQUE): a duplicate re-reads the winner.
 */
export async function recordPendingUpgradeGrant(
  admin: SupabaseClient<Database>,
  args: {
    subscriptionId: string;
    studentId: string;
    planId: string;
    deltaSessions: number;
    stripeInvoiceId: string;
  },
): Promise<RecordPendingUpgradeResult | GrantHifzFailure> {
  // At most one upgrade may be in flight per subscription. Cancel stale
  // pending intents first (best-effort) so the webhook's newest-pending
  // fallback can never pick up an orphaned earlier attempt.
  await admin
    .from("pending_upgrade_grants")
    .update({ status: "cancelled" })
    .eq("subscription_id", args.subscriptionId)
    .eq("status", "pending");

  const { data, error } = await admin
    .from("pending_upgrade_grants")
    .insert({
      subscription_id: args.subscriptionId,
      student_id: args.studentId,
      plan_id: args.planId,
      delta_sessions: args.deltaSessions,
      stripe_invoice_id: args.stripeInvoiceId,
    })
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error?.code === "23505") {
    // Duplicate submission for the same proration invoice — idempotent no-op.
    const { data: winner, error: reselectErr } = await admin
      .from("pending_upgrade_grants")
      .select("id")
      .eq("stripe_invoice_id", args.stripeInvoiceId)
      .maybeSingle<{ id: string }>();
    if (winner) return { ok: true, id: winner.id };
    // Billing-critical path: keep BOTH diagnostics, not a generic shrug.
    return {
      ok: false,
      error: `unique conflict but winner not found (insert: ${error.message}${
        reselectErr ? `; re-select: ${reselectErr.message}` : ""
      })`,
    };
  }
  if (error || !data) {
    logError("catalog.recordPendingUpgradeGrant failed", error ?? new Error("no row"), {
      tag: "billing",
      subscription_id: args.subscriptionId,
      invoice_id: args.stripeInvoiceId,
    });
    return { ok: false, error: error?.message ?? "insert returned no row" };
  }
  return { ok: true, id: data.id };
}

export interface AppliedUpgradeGrantResult {
  ok: true;
  pendingId: string;
  planId: string;
  studentId: string;
  deltaSessions: number;
  grant: GrantHifzResult;
}

export interface AppliedUpgradeGrantFailure {
  ok: false;
  reason: "no_pending" | "lookup_failed" | "update_failed";
  error?: string;
}

/**
 * Apply the pending delta grant for a PAID proration invoice
 * (invoice.paid, billing_reason = 'subscription_update').
 *
 * Mirrors applyPendingTierChangeAtRenewal:
 *   1. Look up the pending row by stripe_invoice_id; fall back to the
 *      subscription's newest pending row (covers the route's defensive
 *      synthetic-invoice-id path — at most one upgrade is in flight).
 *   2. Grant the delta via grant_hifz_cycle_credits with key
 *      `upgrade_${invoiceId}` (idempotent via billing_cycle_key UNIQUE).
 *   3. Transition pending → applied (WHERE status='pending' = replay-safe).
 *
 * Payment failure → this never runs → credits never granted. Fail-closed.
 */
export async function applyImmediateUpgradeGrant(
  admin: SupabaseClient<Database>,
  subscriptionId: string,
  invoiceId: string,
): Promise<AppliedUpgradeGrantResult | AppliedUpgradeGrantFailure> {
  const { data: byInvoice, error: lookupErr } = await admin
    .from("pending_upgrade_grants")
    .select("id, subscription_id, student_id, plan_id, delta_sessions, stripe_invoice_id, status")
    .eq("stripe_invoice_id", invoiceId)
    .eq("status", "pending")
    .maybeSingle<PendingUpgradeGrantRow>();

  if (lookupErr) {
    logError("applyImmediateUpgradeGrant: lookup failed", lookupErr, {
      tag: "billing", subscription_id: subscriptionId, invoice_id: invoiceId,
    });
    return { ok: false, reason: "lookup_failed", error: lookupErr.message };
  }

  let pending = byInvoice;
  if (!pending) {
    // Fallback: the route couldn't read the invoice id off the Stripe update
    // response and stored a synthetic key. At most one upgrade is in flight
    // per subscription, so its newest pending row is it.
    const { data: bySub, error: subLookupErr } = await admin
      .from("pending_upgrade_grants")
      .select("id, subscription_id, student_id, plan_id, delta_sessions, stripe_invoice_id, status")
      .eq("subscription_id", subscriptionId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<PendingUpgradeGrantRow>();
    if (subLookupErr) {
      return { ok: false, reason: "lookup_failed", error: subLookupErr.message };
    }
    pending = bySub;
  }

  if (!pending) return { ok: false, reason: "no_pending" };

  if (pending.subscription_id !== subscriptionId) {
    // Should be impossible (invoice → subscription mapping); refuse rather
    // than grant against the wrong subscription.
    return {
      ok: false,
      reason: "lookup_failed",
      error: "pending row belongs to a different subscription",
    };
  }

  const grant = await grantHifzCycleCredits(
    admin,
    pending.subscription_id,
    pending.plan_id,
    `upgrade_${invoiceId}`,
    pending.delta_sessions,
  );
  if (!grant.ok) {
    logError("applyImmediateUpgradeGrant: delta grant failed", new Error(grant.error), {
      tag: "billing", subscription_id: subscriptionId, invoice_id: invoiceId,
    });
    return { ok: false, reason: "update_failed", error: grant.error };
  }

  const { error: statusErr } = await admin
    .from("pending_upgrade_grants")
    .update({ status: "applied", applied_at: new Date().toISOString() })
    .eq("id", pending.id)
    .eq("status", "pending");
  if (statusErr) {
    logError("applyImmediateUpgradeGrant: status transition failed", statusErr, {
      tag: "billing", pending_id: pending.id,
    });
    return { ok: false, reason: "update_failed", error: statusErr.message };
  }

  return {
    ok: true,
    pendingId: pending.id,
    planId: pending.plan_id,
    studentId: pending.student_id,
    deltaSessions: pending.delta_sessions,
    grant,
  };
}

/**
 * Point an intent-keyed pending row at the real proration invoice id once
 * Stripe has created it. Failure is survivable: applyImmediateUpgradeGrant
 * falls back to the subscription's newest pending row, so the grant still
 * lands keyed to the real invoice — but log loudly.
 */
export async function attachInvoiceToPendingUpgrade(
  admin: SupabaseClient<Database>,
  pendingId: string,
  stripeInvoiceId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await admin
    .from("pending_upgrade_grants")
    .update({ stripe_invoice_id: stripeInvoiceId })
    .eq("id", pendingId)
    .eq("status", "pending");
  if (error) {
    logError("catalog.attachInvoiceToPendingUpgrade failed", error, {
      tag: "billing", pending_id: pendingId, invoice_id: stripeInvoiceId,
    });
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/** Cancel a pending upgrade intent (e.g. the Stripe update itself failed). */
export async function cancelPendingUpgradeGrant(
  admin: SupabaseClient<Database>,
  pendingId: string,
): Promise<void> {
  const { error } = await admin
    .from("pending_upgrade_grants")
    .update({ status: "cancelled" })
    .eq("id", pendingId)
    .eq("status", "pending");
  if (error) {
    logError("catalog.cancelPendingUpgradeGrant failed", error, {
      tag: "billing", pending_id: pendingId,
    });
  }
}
