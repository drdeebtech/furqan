import "server-only";

/**
 * Canonical billing event names (spec 018 / T015).
 *
 * Typed names only (AGENTS.md §4): every entry is a member of `FurqanEvent`,
 * so a typo is a compile error. The enum itself lives in `WEBHOOK_ROUTES`
 * (`src/lib/automation/emit.ts`); this module is the billing domain's stable
 * handle on the four subscription lifecycle events it emits post-commit.
 */

import type { FurqanEvent } from "@/lib/automation/emit";

export const BillingEvents = {
  Activated: "subscription.activated",
  Renewed: "subscription.renewed",
  PastDue: "subscription.past_due",
  Canceled: "subscription.canceled",
} as const satisfies Record<string, FurqanEvent>;

export type BillingEventName = (typeof BillingEvents)[keyof typeof BillingEvents];
