import "server-only";

import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Catalog domain (spec 019 — Product Catalog + Credit/Package Redesign).
 *
 * Public surface for the hifz catalog browse flow (US1). Reads are cached with
 * `unstable_cache` (tag `'hifz-catalog'`); an admin catalog edit calls
 * `revalidateTag('hifz-catalog')` to flush.
 *
 * All prices come from DB rows — never hardcoded (NFR-001).
 */

/** One purchasable hifz tier in the catalog (matches API contract HifzTierSchema). */
export interface CatalogTier {
  id: string;
  name: string;
  tier_type: "group" | "individual";
  sessions_per_month: number;
  session_duration_minutes: number;
  price_usd: string;
  plan_id: string;
  package_id: string;
}

/** Raw DB row shape from the packages JOIN subscription_plans query. */
interface CatalogTierRow {
  id: string;
  name: string;
  product_category: string | null;
  price_usd: number;
  subscription_plan_id: string | null;
  plan_sessions_per_month: number | null;
  plan_session_duration_min: number | null;
}

/** Map a raw DB row to a CatalogTier. Pure — no I/O. */
function mapTier(row: CatalogTierRow): CatalogTier | null {
  if (!row.subscription_plan_id) return null;
  if (!row.plan_sessions_per_month || row.plan_sessions_per_month <= 0) return null;
  if (!row.plan_session_duration_min || row.plan_session_duration_min <= 0) return null;

  if (
    row.product_category !== "hifz_group" &&
    row.product_category !== "hifz_individual"
  )
    return null;

  const tierType: "group" | "individual" =
    row.product_category === "hifz_individual" ? "individual" : "group";

  return {
    id: row.id,
    name: row.name,
    tier_type: tierType,
    sessions_per_month: row.plan_sessions_per_month,
    session_duration_minutes: row.plan_session_duration_min,
    price_usd: row.price_usd.toFixed(2),
    plan_id: row.subscription_plan_id,
    package_id: row.id,
  };
}

/**
 * Fetch all active hifz catalog tiers.
 *
 * Queries `packages` JOIN `subscription_plans` WHERE `is_hifz_product = true`.
 * Ordered by tier_type (group first), then sessions_per_month ascending.
 * Cached with tag `'hifz-catalog'`, TTL 3600s.
 */
export const getActiveCatalogTiers = unstable_cache(
  async (): Promise<CatalogTier[]> => {
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from("packages")
      .select(
        `
        id,
        name,
        product_category,
        price_usd,
        subscription_plan_id,
        subscription_plans!inner (
          sessions_per_month,
          session_duration_min
        )
      `,
      )
      .eq("is_hifz_product", true)
      .eq("is_active", true)
      .order("display_order", { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch active hifz catalog tiers: ${error.message}`);
    }
    if (!data) {
      return [];
    }

    const tiers: CatalogTier[] = [];
    for (const row of data) {
      const planData = Array.isArray(row.subscription_plans)
        ? row.subscription_plans[0]
        : row.subscription_plans;
      const mapped = mapTier({
        id: row.id,
        name: row.name,
        product_category: row.product_category,
        price_usd: Number(row.price_usd),
        subscription_plan_id: row.subscription_plan_id,
        plan_sessions_per_month: planData?.sessions_per_month ?? null,
        plan_session_duration_min: planData?.session_duration_min ?? null,
      });
      if (mapped) tiers.push(mapped);
    }

    // Sort: group first, then sessions_per_month ascending.
    tiers.sort((a, b) => {
      if (a.tier_type !== b.tier_type) {
        return a.tier_type === "group" ? -1 : 1;
      }
      return a.sessions_per_month - b.sessions_per_month;
    });

    return tiers;
  },
  ["hifz-catalog"],
  { tags: ["hifz-catalog"], revalidate: 3600 },
);
