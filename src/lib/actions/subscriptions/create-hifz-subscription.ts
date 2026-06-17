import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase.generated";
import { logError } from "@/lib/logger";
import {
  resolveGuardianDiscount,
  recordDiscount,
  type DiscountResolution,
  type ResolvedDiscount,
} from "@/lib/domains/catalog/discounts";

/**
 * Spec 019 — Single Active Hifz Guard (US2 / T010).
 *
 * A student may hold at most one active hifz product at any time (FR-007).
 * This action checks the invariant BEFORE the Stripe checkout call; the DB
 * partial unique index `uix_subscriptions_one_active_hifz` is the concurrency
 * backstop (FR-009 / R-001).
 *
 * Tajweed/mutoon courses (is_hifz_product = false) are NOT blocked — they run
 * concurrently with a hifz subscription (FR-008).
 */

/** Thrown when a student already holds an active hifz subscription. */
export class HifzAlreadyActiveError extends Error {
  constructor(
    message = "You already have an active hifz subscription. Tajweed courses can be added alongside.",
  ) {
    super(message);
    this.name = "HifzAlreadyActiveError";
  }
}

/** Thrown when the requested plan is not found or not a hifz product. */
export class InvalidHifzPlanError extends Error {
  constructor(message = "Invalid or inactive hifz plan") {
    super(message);
    this.name = "InvalidHifzPlanError";
  }
}

/**
 * Check whether a student already holds an active hifz subscription.
 * Active = status NOT IN ('canceled', 'incomplete_expired') AND is_hifz = true.
 *
 * Returns true if an active hifz subscription exists, false otherwise.
 */
export async function hasActiveHifzSubscription(
  admin: SupabaseClient<Database>,
  studentId: string,
): Promise<boolean> {
  const { count, error } = await admin
    .from("subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("student_id", studentId)
    .eq("is_hifz", true)
    .not("status", "in", "(canceled,incomplete_expired)");

  if (error) throw error;
  return (count ?? 0) > 0;
}

/**
 * Assert that the student does NOT already hold an active hifz subscription.
 * Throws HifzAlreadyActiveError if they do.
 *
 * Call this BEFORE creating a Stripe checkout session for a hifz plan.
 */
export async function assertNoActiveHifz(
  admin: SupabaseClient<Database>,
  studentId: string,
): Promise<void> {
  const active = await hasActiveHifzSubscription(admin, studentId);
  if (active) {
    throw new HifzAlreadyActiveError();
  }
}

/**
 * Resolve whether a subscription plan is a hifz product.
 * Used by the checkout route to decide whether to run the single-active-hifz guard.
 */
export async function isPlanHifzProduct(
  admin: SupabaseClient<Database>,
  planId: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from("subscription_plans")
    .select("is_hifz_product")
    .eq("id", planId)
    .maybeSingle<{ is_hifz_product: boolean }>();

  if (error) throw error;
  return data?.is_hifz_product ?? false;
}

/**
 * Resolve family discount for a student (child) at checkout.
 *
 * Looks up any guardians linked to this student via `guardian_children`, then
 * delegates to `resolveGuardianDiscount` for each guardian. Returns the best
 * (highest-percentage) discount found, or `{ applies: false }` if none.
 *
 * Call this BEFORE creating the Stripe checkout session (T019 / spec 019 US4).
 */
export async function resolveStudentFamilyDiscount(
  admin: SupabaseClient<Database>,
  studentId: string,
  productCategory: string,
): Promise<DiscountResolution> {
  const { data: guardianLinks, error: linksErr } = await admin
    .from("guardian_children")
    .select("guardian_id")
    .eq("child_id", studentId);

  if (linksErr) {
    logError("resolveStudentFamilyDiscount: guardian_children lookup failed", linksErr, {
      tag: "billing",
      student_id: studentId,
    });
    return { applies: false };
  }

  if (!guardianLinks || guardianLinks.length === 0) {
    return { applies: false };
  }

  let best: DiscountResolution = { applies: false };

  for (const link of guardianLinks) {
    try {
      const result = await resolveGuardianDiscount(admin, link.guardian_id, productCategory);
      if (result.applies) {
        if (!best.applies || result.discountPct > best.discountPct) {
          best = result;
        }
      }
    } catch (err) {
      logError("resolveStudentFamilyDiscount: guardian lookup failed", err, {
        tag: "billing",
        guardian_id: link.guardian_id,
      });
    }
  }

  return best;
}

/**
 * Record an applied family discount once the Supabase subscriptionId is known.
 * Call this from the `customer.subscription.created` / `invoice.paid` webhook
 * after the subscription row has been mirrored into the local `subscriptions` table.
 */
export async function recordSubscriptionDiscount(
  admin: SupabaseClient<Database>,
  subscriptionId: string,
  discount: ResolvedDiscount,
): Promise<void> {
  return recordDiscount(admin, subscriptionId, discount);
}

// Re-export discount types for use in the checkout route and webhook.
export type { DiscountResolution, ResolvedDiscount };
