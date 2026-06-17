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
