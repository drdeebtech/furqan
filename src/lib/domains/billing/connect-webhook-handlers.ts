// Spec 040 Phase 3 — handlers for the Connect webhook endpoint
// (/api/stripe/connect-webhook). This endpoint receives CONNECTED-ACCOUNT
// events only (account.updated, transfer.*, payout.*) — refund/dispute
// charges live on the platform account and are processed exclusively by the
// existing /api/stripe/webhook route (one authoritative path, plan Phase 3).
//
// Money invariant: these handlers NEVER create money rows. Transfers and
// reversals are written synchronously by the sweep/clawback paths; the
// webhook only mirrors account status and reconciles transfer status.
//
// Reuses the platform webhook's EventContext/markEvent seam so both
// endpoints share one idempotency ledger (billing_events UNIQUE).

import type Stripe from "stripe";
import { callRpc } from "@/lib/supabase/rpc";
import { logError } from "@/lib/logger";
import {
  applyAccountUpdate,
  type ConnectAccountsStore,
} from "@/lib/domains/connect/connect-accounts";
import {
  applyChargeClawbacks,
  disputeChargeId,
  releaseDisputedEntries,
} from "@/lib/domains/connect/clawback";
import { markEvent, type EventContext } from "./webhook-handlers";
import type { Json } from "@/types/database";

/**
 * account.updated → recency-guarded mirror write (FR-003), honouring the
 * BINDING requirements recorded in connect-accounts.ts:
 *   * Stripe event.created has 1-second resolution, so a 'stale' verdict may
 *     actually be a same-second tie — we then `accounts.retrieve` the
 *     AUTHORITATIVE state and re-apply with the current clock, which is
 *     strictly newer than any stored event time. Ties become moot.
 *   * 'unknown_account' for an account carrying OUR metadata
 *     (furqan_teacher_id) means this event beat our own linkAccount commit —
 *     we THROW so the route 500s and Stripe redelivers (by then the link has
 *     committed). Foreign accounts (no metadata) are ignored.
 */
export async function handleConnectAccountUpdated(
  ctx: EventContext,
  store: ConnectAccountsStore,
): Promise<void> {
  const account = ctx.event.data.object as Stripe.Account;
  const snapshot = accountSnapshot(account, new Date(ctx.event.created * 1000));

  const outcome = await applyAccountUpdate(store, snapshot);

  if (outcome === "applied") {
    await markEvent(ctx, "processed");
    return;
  }

  if (outcome === "stale") {
    // Possibly a same-second tie the <= guard cannot order — fetch the
    // authoritative current state and re-apply with now() (monotonic).
    const authoritative = await ctx.stripe.accounts.retrieve(account.id);
    const retried = await applyAccountUpdate(
      store,
      accountSnapshot(authoritative as Stripe.Account, new Date()),
    );
    if (retried === "applied") {
      await markEvent(ctx, "processed");
      return;
    }
    logError("connect-webhook: authoritative re-apply did not land", null, {
      tag: "connect-webhook",
      metadata: { account: account.id, retried },
    });
    await markEvent(ctx, "processed"); // stale twice = newer state already stored
    return;
  }

  // unknown_account
  if (account.metadata?.furqan_teacher_id) {
    // Our account, link not yet committed — loud retryable failure (FR-003
    // binding requirement: never drop our snapshot with a 2xx).
    throw new Error(
      `connect-webhook: account.updated for our account ${account.id} before link committed — retry`,
    );
  }
  await markEvent(ctx, "ignored"); // foreign account — not ours to mirror
}

/**
 * transfer.created / transfer.reversed → status reconciliation ONLY (the
 * sweep wrote the row synchronously; a missing row is loud, not fatal).
 */
export async function handleConnectTransferEvent(ctx: EventContext): Promise<void> {
  const transfer = ctx.event.data.object as Stripe.Transfer;
  const reversed = ctx.event.type === "transfer.reversed";

  const { data, error } = await callRpc(ctx.admin, "connect_reconcile_transfer", {
    p_stripe_transfer_id: transfer.id,
    p_reversed: reversed,
  });
  if (error) {
    throw new Error(`connect-webhook: reconcile rpc failed: ${error.message}`);
  }
  if (data === "unknown_transfer") {
    // A transfer we did not create (or a row lost) — ops signal, not a crash:
    // the sweep's UNIQUE constraints make a missing row an anomaly to inspect,
    // and throwing would make Stripe redeliver an event that cannot heal.
    logError("connect-webhook: transfer event for unknown teacher_transfers row", null, {
      tag: "connect-webhook",
      metadata: { transferId: transfer.id, type: ctx.event.type },
    });
  }
  await markEvent(ctx, "processed");
}

/**
 * payout.paid / payout.failed on the CONNECTED account (teacher's bank
 * payout) → informational; failure raises an ops alert (Sentry via logError).
 * No DB effect: bank-payout state is Stripe's, not ours.
 */
export async function handleConnectPayoutEvent(ctx: EventContext): Promise<void> {
  const payout = ctx.event.data.object as Stripe.Payout;
  if (ctx.event.type === "payout.failed") {
    logError("connect-webhook: teacher bank payout FAILED", new Error("payout.failed"), {
      tag: "connect-webhook",
      metadata: {
        payoutId: payout.id,
        account: ctx.event.account ?? null,
        failureCode: payout.failure_code ?? null,
        failureMessage: payout.failure_message ?? null,
      },
    });
  }
  await markEvent(ctx, "processed");
}

/** Minimize the mirrored requirements payload to the summary fields FR-003
 *  needs — never the full Stripe object (evidence-minimization posture). */
function accountSnapshot(account: Stripe.Account, eventAt: Date) {
  const requirements: Json = {
    currently_due: account.requirements?.currently_due ?? [],
    past_due: account.requirements?.past_due ?? [],
    disabled_reason: account.requirements?.disabled_reason ?? null,
  };
  return {
    stripeAccountId: account.id,
    chargesEnabled: account.charges_enabled === true,
    payoutsEnabled: account.payouts_enabled === true,
    detailsSubmitted: account.details_submitted === true,
    requirements,
    eventAt,
  };
}


// ── charge.dispute.closed (dispatched from the PLATFORM webhook route) ───────
//
// FR-015 resolution: won (or an inquiry closed without a dispute) releases
// this dispute's own holds back to pending; lost claws back FIRST — while the
// entries are still held, so no sweep window opens between resolution and
// clawback — and only then releases whatever partial remainder survives to
// the FR-014 netting rail. The prepaid-lot student side is deliberately
// untouched here (handleChargeDisputed's created-time void is final; "We do
// NOT un-void if the dispute is later won" — see that handler).
export async function handleChargeDisputeClosed(ctx: EventContext): Promise<void> {
  const dispute = ctx.event.data.object as Stripe.Dispute;
  const chargeId = disputeChargeId(dispute);
  if (!chargeId) {
    await markEvent(ctx, "ignored", "dispute.closed without a charge id");
    return;
  }

  if (dispute.status === "won" || dispute.status === "warning_closed") {
    const released = await releaseDisputedEntries(ctx, dispute.id); // throws → dispatch marks failed, Stripe retries
    await markEvent(ctx, "processed", `dispute won/closed: released ${released} entries`);
    return;
  }

  if (dispute.status === "lost") {
    // Charge total is needed for the proportional split and is not on the
    // Dispute object — fetch it (read-only; a transport failure throws and
    // the event retries before any write).
    const charge = await ctx.stripe.charges.retrieve(chargeId);
    await applyChargeClawbacks(ctx, {
      chargeId,
      sourceReferenceId: dispute.id,
      reclaimedCents: dispute.amount,
      chargeAmountCents: charge.amount,
      source: "dispute",
    });
    const released = await releaseDisputedEntries(ctx, dispute.id);
    await markEvent(ctx, "processed", `dispute lost: clawed back; released ${released} residual entries`);
    return;
  }

  // Unexpected status on a .closed event — leave the holds in place
  // (fail-safe: held money cannot move) and surface for ops.
  logError("stripe-webhook: dispute.closed with unexpected status; holds left in place", null, {
    tag: "stripe-webhook",
    event_id: ctx.event.id,
    dispute_id: dispute.id,
    dispute_status: dispute.status,
  });
  await markEvent(ctx, "processed", `dispute.closed status ${dispute.status}; holds kept`);
}
