import "server-only";

/**
 * Subscription plan catalog reads (spec 018).
 *
 * The catalog is the binding source of a cycle's grant size and price — the
 * checkout route resolves a plan by code and reads `stripe_price_id` /
 * `monthly_credit_count` / `price_cents` from it, NEVER from client input
 * (checkout.contract.md). Active plans are SELECT-able by anon/authenticated
 * via RLS, so either the user client or the service-role client works here.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/supabase.generated";
import type { SubscriptionPlan } from "./types";
import { logError } from "@/lib/logger";

const PLAN_COLUMNS =
  "id, plan_code, name, plan_type, monthly_credit_count, session_metadata, price_cents, currency, stripe_product_id, stripe_price_id, paypal_plan_id, is_active" as const;

type PlanRow = {
  id: string;
  plan_code: string;
  name: string;
  plan_type: Database["public"]["Enums"]["billing_plan_type"];
  monthly_credit_count: number;
  session_metadata: Json;
  price_cents: number;
  currency: string;
  stripe_product_id: string;
  stripe_price_id: string;
  paypal_plan_id: string | null;
  is_active: boolean;
};

function toDomain(r: PlanRow): SubscriptionPlan {
  return {
    id: r.id,
    planCode: r.plan_code,
    name: r.name,
    planType: r.plan_type,
    monthlyCreditCount: r.monthly_credit_count,
    sessionMetadata: (r.session_metadata ?? {}) as Record<string, unknown>,
    priceCents: r.price_cents,
    currency: r.currency,
    stripeProductId: r.stripe_product_id,
    stripePriceId: r.stripe_price_id,
    paypalPlanId: r.paypal_plan_id,
    isActive: r.is_active,
  };
}

/** Look up an active plan by its stable code. Returns null if not found/inactive. */
export async function getActivePlanByCode(
  client: SupabaseClient<Database>,
  planCode: string,
): Promise<SubscriptionPlan | null> {
  const { data, error } = await client
    .from("subscription_plans")
    .select(PLAN_COLUMNS)
    .eq("plan_code", planCode)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    logError("billing.getActivePlanByCode failed", error, {
      tag: "billing", plan_code: planCode,
    });
    return null;
  }
  return data ? toDomain(data as PlanRow) : null;
}

/** Look up a plan by id (used by the grant orchestrator when resolving an invoice). */
export async function getPlanById(
  client: SupabaseClient<Database>,
  planId: string,
): Promise<SubscriptionPlan | null> {
  const { data, error } = await client
    .from("subscription_plans")
    .select(PLAN_COLUMNS)
    .eq("id", planId)
    .maybeSingle();

  if (error) {
    logError("billing.getPlanById failed", error, { tag: "billing", plan_id: planId });
    return null;
  }
  return data ? toDomain(data as PlanRow) : null;
}
