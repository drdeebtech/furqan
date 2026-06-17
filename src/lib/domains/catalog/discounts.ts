import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase.generated";
import { getSetting } from "@/lib/settings";
import { logError } from "@/lib/logger";

/**
 * Spec 019 — Guardian Family Discounts domain (US4 / T016).
 *
 * Resolves whether a guardian qualifies for a discount on a new hifz subscription
 * for one of their children, and records the applied discount immutably.
 */

export type DiscountType = "second_individual" | "sibling_group";

export interface ResolvedDiscount {
  applies: true;
  discountType: DiscountType;
  discountPct: number;
  settingKey: string;
}

export interface NoDiscount {
  applies: false;
}

export type DiscountResolution = ResolvedDiscount | NoDiscount;

/**
 * Resolve whether a guardian qualifies for a family discount on a new hifz subscription.
 *
 * Rules (from platform_settings, adjustable by admin):
 * - `second_individual`: guardian already has one active individual-hifz subscription
 *   across their children; second individual gets `hifz_second_individual_discount_pct`.
 * - `sibling_group`: guardian has at least one active group-hifz subscription across
 *   their children; new group subscription gets `hifz_sibling_group_discount_pct`.
 *
 * Returns `{ applies: false }` when no discount applies (most common case).
 */
export async function resolveGuardianDiscount(
  admin: SupabaseClient<Database>,
  guardianId: string,
  productCategory: string,
): Promise<DiscountResolution> {
  const { data: links, error: linksErr } = await admin
    .from("guardian_children")
    .select("child_id")
    .eq("guardian_id", guardianId);

  if (linksErr) {
    logError("resolveGuardianDiscount: guardian_children lookup failed", linksErr, {
      tag: "billing",
      guardian_id: guardianId,
    });
    return { applies: false };
  }

  if (!links || links.length === 0) return { applies: false };

  const childIds = links.map((l) => l.child_id);

  const { data: activeSubs, error: subsErr } = await admin
    .from("subscriptions")
    .select("id, student_id, plan_id, subscription_plans!inner(is_hifz_product, sessions_per_month)")
    .in("student_id", childIds)
    .eq("is_hifz", true)
    .not("status", "in", '("canceled","incomplete_expired")');

  if (subsErr) {
    logError("resolveGuardianDiscount: active subscriptions lookup failed", subsErr, {
      tag: "billing",
      guardian_id: guardianId,
    });
    return { applies: false };
  }

  if (!activeSubs || activeSubs.length === 0) return { applies: false };

  if (productCategory === "hifz_individual") {
    const hasIndividual = activeSubs.some((s) => {
      const plan = Array.isArray(s.subscription_plans)
        ? s.subscription_plans[0]
        : s.subscription_plans;
      return plan?.is_hifz_product === true;
    });

    if (hasIndividual) {
      const pctStr = await getSetting("hifz_second_individual_discount_pct");
      const discountPct = pctStr ? parseFloat(pctStr) : 0;
      if (discountPct > 0) {
        return {
          applies: true,
          discountType: "second_individual",
          discountPct,
          settingKey: "hifz_second_individual_discount_pct",
        };
      }
    }
  }

  if (productCategory === "hifz_group") {
    if (activeSubs.length > 0) {
      const pctStr = await getSetting("hifz_sibling_group_discount_pct");
      const discountPct = pctStr ? parseFloat(pctStr) : 0;
      if (discountPct > 0) {
        return {
          applies: true,
          discountType: "sibling_group",
          discountPct,
          settingKey: "hifz_sibling_group_discount_pct",
        };
      }
    }
  }

  return { applies: false };
}

/**
 * Record an applied discount immutably in `subscription_discount_records`.
 * Service-role client only — RLS blocks authenticated writes.
 */
export async function recordDiscount(
  admin: SupabaseClient<Database>,
  subscriptionId: string,
  discount: ResolvedDiscount,
): Promise<void> {
  const { error } = await admin.from("subscription_discount_records").insert({
    subscription_id: subscriptionId,
    discount_type: discount.discountType,
    discount_pct: discount.discountPct,
    setting_key: discount.settingKey,
  });

  if (error) {
    logError("recordDiscount: insert failed", error, {
      tag: "billing",
      subscription_id: subscriptionId,
      discount_type: discount.discountType,
    });
  }
}
