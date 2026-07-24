import "server-only";

/**
 * Billing domain types (spec 018 / data-model.md).
 *
 * These mirror the generated Supabase types but expose a stable, domain-shaped
 * vocabulary so route adapters and the orchestrator don't depend on raw DB row
 * shapes. Money is integer cents (USD only — FR-008). Identity columns come from
 * the session, never request input.
 */

import type { Database } from "@/types/supabase.generated";

/** Subscription lifecycle status (mirror of the Stripe lifecycle we model). */
export type SubscriptionStatus = Database["public"]["Enums"]["subscription_status"];
/** Plan type — recurring monthly is the MVP; limited-duration is spec 019. */
export type BillingPlanType = Database["public"]["Enums"]["billing_plan_type"];
/** Billing-event ledger row state (idempotency / audit). */
export type BillingEventStatus = Database["public"]["Enums"]["billing_event_status"];

/** Catalog row — the binding source of what one paid cycle grants. */
export interface SubscriptionPlan {
  id: string;
  planCode: string;
  name: string;
  planType: BillingPlanType;
  monthlyCreditCount: number;
  sessionMetadata: Record<string, unknown>;
  priceCents: number;
  currency: string;
  stripeProductId: string;
  stripePriceId: string;
  isActive: boolean;
}

/** Lifecycle mirror row. */
export interface SubscriptionMirror {
  id: string;
  studentId: string;
  payerUserId: string | null;
  planId: string;
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
  status: SubscriptionStatus;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  lastEventAt: string;
  canceledAt: string | null;
}

/**
 * Input shape for `grant_subscription_cycle` choreography. All fields are
 * resolved server-side from the catalog + the verified Stripe event — never
 * from client input (FR-010). `cycleKey` is the idempotency key (R3).
 */
export interface GrantCycleInput {
  subscriptionId: string;
  studentId: string;
  planId: string;
  /** invoice_id + sub_id + period_start — unique per paid cycle. */
  cycleKey: string;
  stripePaymentIntent: string;
  amountCents: number;
  creditCount: number;
  expiresAt: string;
  sessionMetadata: Record<string, unknown>;
}

/** Result of the grant choreography (success branch). */
export interface GrantCycleResult {
  ok: true;
  /** student_packages grant id (existing or newly created — idempotent). */
  grantId: string;
  /** True if this call created a new grant; false if it was a no-op replay. */
  created: boolean;
}

/** Result of the grant choreography (failure branch). */
export interface GrantCycleFailure {
  ok: false;
  error: string;
}

/** The Stripe customer mapping for a user. */
export interface StripeCustomer {
  id: string;
  userId: string;
  stripeCustomerId: string;
}
