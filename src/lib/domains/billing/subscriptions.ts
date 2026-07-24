import "server-only";

/**
 * Subscription mirror upsert with a recency guard (spec 018 / R5).
 *
 * Stripe is the source of truth. Webhook delivery is at-least-once and can
 * arrive out of order (e.g. a stale `active` after a `deleted`). The mirror
 * must never regress: an event is applied ONLY if it is at least as new as the
 * last event we processed (`event.created >= last_event_at`).
 *
 * The recency comparison is a pure function (`shouldApplyEvent`) so it can be
 * unit-tested without a database (T018). The DB-touching `upsertMirror` is a
 * thin adapter that calls it before any write.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase.generated";
import type { SubscriptionMirror, SubscriptionStatus } from "./types";
import { logError } from "@/lib/logger";

export type BillingSubscriptionProvider = "stripe" | "paypal";

/** A normalized Stripe subscription snapshot extracted from a webhook event. */
export interface StripeSubscriptionSnapshot {
  provider?: BillingSubscriptionProvider;
  providerSubscriptionId?: string;
  providerCustomerId?: string | null;
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  status: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  /** Stripe `event.created` (unix seconds). */
  eventCreatedSeconds: number;
  /** student_id resolved from metadata/client_reference (server-side). */
  studentId: string;
  payerUserId?: string | null;
  planId?: string | null;
}

/**
 * Recency guard (R5). Pure — no I/O.
 *
 * @param eventCreatedMs   the event's `created` timestamp in epoch ms
 * @param lastEventAtMs    the mirror's `last_event_at` in epoch ms (epoch=0 if never set)
 * @returns true iff the event is at least as new as the last applied event
 */
export function shouldApplyEvent(eventCreatedMs: number, lastEventAtMs: number): boolean {
  return eventCreatedMs >= lastEventAtMs;
}

/** Convert a Stripe status string to our enum, defaulting to `incomplete`. */
export function toSubscriptionStatus(status: string): SubscriptionStatus {
  const allowed: SubscriptionStatus[] = [
    "incomplete", "active", "past_due", "canceled", "incomplete_expired", "unpaid",
  ];
  return (allowed as string[]).includes(status) ? (status as SubscriptionStatus) : "incomplete";
}

function toMs(isoOrNull: string | null): number {
  if (!isoOrNull) return 0;
  const ms = Date.parse(isoOrNull);
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * Recency-guarded mirror upsert. Service-role client only (writes).
 *
 * Returns the mirror row (after apply) or null if a stale event was rejected.
 * Never throws — a mirror failure must NOT roll back the already-committed
 * grant (Principle III: atomic critical path, best-effort side effects). A
 * failure is logged loudly and surfaces as null so the caller can mark the
 * billing_event `failed`.
 */
export async function upsertMirror(
  admin: SupabaseClient<Database>,
  snap: StripeSubscriptionSnapshot,
): Promise<SubscriptionMirror | null> {
  const provider = snap.provider ?? "stripe";
  const providerSubscriptionId = snap.providerSubscriptionId ?? snap.stripeSubscriptionId;
  const providerCustomerId = snap.providerCustomerId !== undefined
    ? snap.providerCustomerId
    : snap.stripeCustomerId;
  try {
    // Lock the provider row to read last_event_at consistently.
    const { data: existing, error: readErr } = await admin
      .from("subscriptions")
      .select("id, last_event_at")
      .eq("provider", provider)
      .eq("provider_subscription_id", providerSubscriptionId)
      .maybeSingle();

    if (readErr) {
      logError("billing.upsertMirror read failed", readErr, {
        tag: "billing", provider, provider_subscription_id: providerSubscriptionId,
      });
      return null;
    }

    const eventCreatedMs = snap.eventCreatedSeconds * 1000;

    if (existing) {
      // Recency guard: reject out-of-order / stale delivery.
      if (!shouldApplyEvent(eventCreatedMs, toMs(existing.last_event_at))) {
        return null;
      }
      const newStatus = toSubscriptionStatus(snap.status);
      const patch = {
        status: newStatus,
        current_period_start: snap.currentPeriodStart,
        current_period_end: snap.currentPeriodEnd,
        cancel_at_period_end: snap.cancelAtPeriodEnd,
        last_event_at: new Date(eventCreatedMs).toISOString(),
        // canceled_at is set the moment the mirror flips to canceled.
        ...(newStatus === "canceled" ? { canceled_at: new Date(eventCreatedMs).toISOString() } : {}),
        ...(snap.planId ? { plan_id: snap.planId } : {}),
        ...(snap.payerUserId !== undefined ? { payer_user_id: snap.payerUserId } : {}),
      };
      const { data: updated, error: updErr } = await admin
        .from("subscriptions")
        .update(patch)
        .eq("id", existing.id)
        .lte("last_event_at", new Date(eventCreatedMs).toISOString())
        .select(rowShape)
        .maybeSingle();
      if (updErr) {
        logError("billing.upsertMirror update failed", updErr, {
          tag: "billing", provider, subscription_id: existing.id,
        });
        return null;
      }
      // updated is null when WHERE predicate filtered (stale event lost atomic race).
      return updated ? toDomain(updated) : null;
    }

    // No existing row — insert. last_event_at seeds the recency baseline.
    // plan_id is NOT NULL on subscriptions; a mirror cannot be created without
    // a resolved plan (the webhook handler resolves it from the sub's price).
    if (!snap.planId) {
      logError("billing.upsertMirror insert skipped: missing plan_id", new Error("missing plan_id"), {
        tag: "billing", provider, provider_subscription_id: providerSubscriptionId,
      });
      return null;
    }
    const insertStatus = toSubscriptionStatus(snap.status);
    const insert = {
      student_id: snap.studentId,
      plan_id: snap.planId,
      provider,
      provider_subscription_id: providerSubscriptionId,
      provider_customer_id: providerCustomerId,
      stripe_subscription_id: provider === "stripe" ? snap.stripeSubscriptionId : null,
      stripe_customer_id: provider === "stripe" ? snap.stripeCustomerId : null,
      status: insertStatus,
      current_period_start: snap.currentPeriodStart,
      current_period_end: snap.currentPeriodEnd,
      cancel_at_period_end: snap.cancelAtPeriodEnd,
      last_event_at: new Date(eventCreatedMs).toISOString(),
      payer_user_id: snap.payerUserId ?? null,
      ...(insertStatus === "canceled" ? { canceled_at: new Date(eventCreatedMs).toISOString() } : {}),
    };
    const { data: created, error: insErr } = await admin
      .from("subscriptions")
      .insert(insert)
      .select(rowShape)
      .single();
    if (insErr || !created) {
      logError("billing.upsertMirror insert failed", insErr ?? new Error("no row"), {
        tag: "billing", provider, provider_subscription_id: providerSubscriptionId,
      });
      return null;
    }
    return toDomain(created);
  } catch (err) {
    logError("billing.upsertMirror crashed", err, {
      tag: "billing", provider, provider_subscription_id: providerSubscriptionId,
    });
    return null;
  }
}

const rowShape =
  "id, student_id, payer_user_id, plan_id, provider, provider_subscription_id, provider_customer_id, stripe_subscription_id, stripe_customer_id, status, current_period_start, current_period_end, cancel_at_period_end, last_event_at, canceled_at" as const;

type MirrorRow = {
  id: string;
  student_id: string;
  payer_user_id: string | null;
  plan_id: string;
  provider: string;
  provider_subscription_id: string | null;
  provider_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_customer_id: string | null;
  status: SubscriptionStatus;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  last_event_at: string;
  canceled_at: string | null;
};

function toDomain(r: MirrorRow): SubscriptionMirror {
  return {
    id: r.id,
    studentId: r.student_id,
    payerUserId: r.payer_user_id,
    planId: r.plan_id,
    provider: r.provider === "paypal" ? "paypal" : "stripe",
    providerSubscriptionId: r.provider_subscription_id,
    providerCustomerId: r.provider_customer_id,
    stripeSubscriptionId: r.stripe_subscription_id,
    stripeCustomerId: r.stripe_customer_id,
    status: r.status,
    currentPeriodStart: r.current_period_start,
    currentPeriodEnd: r.current_period_end,
    cancelAtPeriodEnd: r.cancel_at_period_end,
    lastEventAt: r.last_event_at,
    canceledAt: r.canceled_at,
  };
}
