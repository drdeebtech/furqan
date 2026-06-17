import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase.generated";
import { logError } from "@/lib/logger";

/**
 * Spec 019 — Mid-Month Tier Upgrade domain (US5 / T021).
 *
 * `canUpgradeImmediately` — checks whether a tier change qualifies for an
 * immediate proration upgrade vs. a deferred renewal change.
 *
 * `scheduleRenewalChange` — inserts a `pending_tier_changes` row so the
 * renewal webhook (T014a) applies the change at next cycle.
 */

export interface CurrentTierInfo {
  subscriptionId: string;
  stripeSubscriptionId: string;
  planId: string;
  packageId: string;
  productCategory: string;
  sessionsPerMonth: number;
  currentPeriodEnd: string;
}

export interface NewTierInfo {
  packageId: string;
  planId: string;
  productCategory: string;
  sessionsPerMonth: number;
}

export interface UpgradeAllowed {
  allowed: true;
  deltaSessions: number;
}

export interface UpgradeDeferred {
  allowed: false;
  reason: "type_mismatch" | "teacher_mismatch" | "not_an_upgrade";
}

export type UpgradeEligibility = UpgradeAllowed | UpgradeDeferred;

/**
 * Determine whether an immediate upgrade is allowed.
 *
 * Immediate upgrade requires:
 * 1. Same `product_category` (both group or both individual).
 * 2. New plan has MORE sessions/month than current (upgrade, not downgrade/lateral).
 *
 * NOTE: FR-017 also requires the same teacher for an immediate upgrade
 * (`teacher_mismatch` reason). This check is not yet implemented because
 * `subscriptions` has no `teacher_id` column — a schema migration is needed
 * to track the assigned teacher per subscription before this can be enforced.
 */
export function canUpgradeImmediately(
  current: CurrentTierInfo,
  newTier: NewTierInfo,
): UpgradeEligibility {
  if (current.productCategory !== newTier.productCategory) {
    return { allowed: false, reason: "type_mismatch" };
  }

  if (newTier.sessionsPerMonth <= current.sessionsPerMonth) {
    return { allowed: false, reason: "not_an_upgrade" };
  }

  return {
    allowed: true,
    deltaSessions: newTier.sessionsPerMonth - current.sessionsPerMonth,
  };
}

/**
 * Insert a `pending_tier_changes` row for changes deferred to renewal.
 *
 * Upsert semantics: any existing `status='pending'` row for this subscription is
 * cancelled first (the partial unique index guarantees at most one pending row).
 * Service-role client only.
 */
export async function scheduleRenewalChange(
  admin: SupabaseClient<Database>,
  opts: {
    subscriptionId: string;
    studentId: string;
    fromPackageId: string;
    toPackageId: string;
    changeReason: "type_change" | "teacher_change" | "downgrade" | "other";
  },
): Promise<{ id: string } | null> {
  const { error: cancelErr } = await admin
    .from("pending_tier_changes")
    .update({ status: "cancelled" })
    .eq("subscription_id", opts.subscriptionId)
    .eq("status", "pending");

  if (cancelErr) {
    logError("scheduleRenewalChange: cancel existing failed", cancelErr, {
      tag: "billing",
      subscription_id: opts.subscriptionId,
    });
  }

  const { data, error } = await admin
    .from("pending_tier_changes")
    .insert({
      subscription_id: opts.subscriptionId,
      student_id: opts.studentId,
      from_package_id: opts.fromPackageId,
      to_package_id: opts.toPackageId,
      change_reason: opts.changeReason,
    })
    .select("id")
    .single();

  if (error) {
    // 23505: concurrent request won the race on the partial UNIQUE index
    // (subscription_id WHERE status='pending'). Re-read the winner so the caller
    // gets a success response instead of a spurious 500 (M-1 fix).
    if (error.code === "23505") {
      const { data: existing } = await admin
        .from("pending_tier_changes")
        .select("id")
        .eq("subscription_id", opts.subscriptionId)
        .eq("status", "pending")
        .maybeSingle();

      if (existing) return { id: existing.id };
    }

    logError("scheduleRenewalChange: insert failed", error, {
      tag: "billing",
      subscription_id: opts.subscriptionId,
    });
    return null;
  }

  return { id: data.id };
}
