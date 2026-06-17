import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase.generated";

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
  const { count } = await admin
    .from("subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("student_id", studentId)
    .eq("is_hifz", true)
    .not("status", "in", '("canceled","incomplete_expired")');

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
  const { data } = await admin
    .from("subscription_plans")
    .select("is_hifz_product")
    .eq("id", planId)
    .maybeSingle<{ is_hifz_product: boolean }>();

  return data?.is_hifz_product ?? false;
}
