/**
 * Billing domain (spec 018).
 *
 * Public surface for route adapters. The orchestrator + mirror upsert are the
 * only write paths; route handlers stay thin (Principle I/IV). All writes go
 * through the service-role client; the user client is used only for catalog
 * reads (RLS-public) and the student's own rows.
 */

export type {
  SubscriptionPlan,
  SubscriptionMirror,
  SubscriptionStatus,
  BillingPlanType,
  BillingEventStatus,
  GrantCycleInput,
  GrantCycleResult,
  GrantCycleFailure,
  StripeCustomer,
} from "./types";

export { BillingEvents, type BillingEventName } from "./events";
export { getActivePlanByCode, getPlanById } from "./plans";
export {
  upsertMirror,
  shouldApplyEvent,
  toSubscriptionStatus,
  type StripeSubscriptionSnapshot,
} from "./subscriptions";
export { grantCycle, buildCycleKey } from "./orchestrate";
export {
  markEvent,
  handleInvoicePaid,
  handlePaymentFailed,
  handleSubscriptionLifecycle,
  handleSubscriptionDeleted,
  handlePaymentIntentSucceeded,
  type EventContext,
} from "./webhook-handlers";
