// Spec 040 Phase 3b — refund/dispute clawback orchestration (FR-013/014/015).
//
// The webhook-side money path promised by ./reversal's header: this module
// creates the Stripe Transfer Reversals and writes the ledger rows; the
// proportional split itself stays in computeProportionalReversalCents (one
// math source). All DB writes go through the service-role RPCs from
// 20260807000000_connect_clawback.sql, which re-clamp every write under a row
// lock — this layer can plan, but only the DB can spend.
//
// Stripe-settled entries use RESERVE-FIRST fencing (adversarial-review P0):
// the reversal row is reserved in the DB (amount clamped under the entry
// lock, frozen) BEFORE stripe.transfers.createReversal, and confirmed after.
// Every retry therefore sends the SAME amount under the same idempotency key
// `reversal:{source}:{transfer}` (FR-013) — no parameter drift — and a crash
// between reserve and the Stripe call is healed by any later redelivery
// resuming the pending reservation. Combined with the per-source DB uniques
// and the billing_events ledger, replaying any event has zero additional
// effect (SC-003).
//
// Residual (accepted): an admin manually reversing a transfer in the Stripe
// dashboard can shrink the reversible balance below a pending reservation —
// createReversal then fails and the event keeps retrying until ops intervene.
// Loud and rare; never a silent money divergence.

import type Stripe from "stripe";
import { after } from "next/server";
import type { EventContext } from "@/lib/domains/billing/webhook-handlers";
import { callRpc } from "@/lib/supabase/rpc";
import { computeProportionalReversalCents } from "./reversal";
import { emitEvent } from "@/lib/automation/emit";
import { MIXPANEL_EVENTS, trackMixpanel } from "@/lib/mixpanel-server";
import { logError } from "@/lib/logger";

export interface ChargeClawbackInput {
  /** Stripe charge id (`ch_…`) of the refunded/disputed charge. */
  chargeId: string;
  /**
   * The charge's PaymentIntent id (`pi_…`), when present. Entries stamp
   * `funding_charge_id` from `payments.stripe_payment_intent` (the DB never
   * stores a `ch_…` id — materialization migration 20260809), so matching must
   * try BOTH identifiers.
   */
  paymentIntentId: string | null;
  /** Stripe refund (re_*) or dispute (dp_*) id — the per-source idempotency key. */
  sourceReferenceId: string;
  /** This refund's own amount (NOT cumulative), or dispute.amount. Cents. */
  reclaimedCents: number;
  /** The original charge total, cents. */
  chargeAmountCents: number;
  source: "refund" | "dispute";
}

export interface ChargeClawbackResult {
  entriesTouched: number;
  reversedCents: number;
  clawbackCents: number;
}

interface ClawbackEntryRow {
  entry_id: string;
  teacher_id: string;
  status: string;
  amount_cents: number;
  remaining_cap_cents: number;
  stripe_transfer_id: string | null;
  source_already_applied: boolean;
}

interface ApplyOutcome {
  outcome: string;
  applied_cents: number;
}

interface ReversalReservation {
  outcome: string;
  reversed_cents: number;
  shortfall_cents: number;
  already_confirmed: boolean;
}

/**
 * Reverse the teacher's proportional share of a refunded/disputed charge
 * across every Connect entry it funded. Throws on any RPC/Stripe failure so
 * the caller marks the event `failed` and Stripe redelivers — a partial pass
 * is safe to re-run through the idempotency layers above.
 */
export async function applyChargeClawbacks(
  ctx: EventContext,
  input: ChargeClawbackInput,
): Promise<ChargeClawbackResult> {
  const result: ChargeClawbackResult = { entriesTouched: 0, reversedCents: 0, clawbackCents: 0 };
  if (input.reclaimedCents <= 0 || input.chargeAmountCents <= 0) {
    return result;
  }

  // Materialize first: a refund landing between delivery and the first sweep
  // must still find its entry (idempotent, cheap when there is nothing to do).
  await materializeLinkedEntries(ctx);

  const rows = await listEntriesForRefs(
    ctx,
    fundingRefs(input.chargeId, input.paymentIntentId),
    input.sourceReferenceId,
  );

  for (const row of rows) {
    // A source we have never touched with an exhausted cap has nothing left.
    // A source we HAVE touched must still enter the settled branch below —
    // reserve/confirm resolve replays and resume crashed reservations.
    if (!row.source_already_applied && row.remaining_cap_cents <= 0) {
      continue;
    }

    if (row.stripe_transfer_id) {
      const settled = await reclaimSettledEntry(ctx, input, row);
      if (settled) {
        result.entriesTouched += 1;
        result.reversedCents += settled.reversedCents;
        result.clawbackCents += settled.clawbackCents;
        emitClawbackEvent(row, input, settled.reversedCents, settled.clawbackCents);
      }
      continue;
    }

    if (row.source_already_applied) {
      continue; // apply path is single-shot per source — pure replay
    }

    // Not settled via Stripe (pending/held/manual/processing/debt_recovered):
    // reversibleBalanceCents=0 puts the full proportional share in
    // shortfallDebtCents; the RPC clamps again (its applied_cents — not our
    // plan — is what actually committed) and voids a clean full reclaim.
    const plan = computeProportionalReversalCents({
      teacherShareCents: row.amount_cents,
      refundedAmountCents: input.reclaimedCents,
      chargeAmountCents: input.chargeAmountCents,
      reversibleBalanceCents: 0,
    });
    const requestedCents = Math.min(plan.shortfallDebtCents, row.remaining_cap_cents);
    if (requestedCents <= 0) continue;
    const { data: applyData, error: applyErr } = await callRpc(ctx.admin, "connect_clawback_apply", {
      p_entry_id: row.entry_id,
      p_source_reference_id: input.sourceReferenceId,
      p_clawback_cents: requestedCents,
    });
    if (applyErr) {
      // Includes the deliberate settled-entry refusal (DB TOCTOU guard): the
      // event fails, Stripe redelivers, the fresh snapshot re-routes here.
      throw new Error(`clawback: apply failed for entry ${row.entry_id}: ${applyErr.message}`);
    }
    const applied = (applyData as ApplyOutcome[] | null)?.[0];
    if (
      !applied ||
      (applied.outcome !== "voided" && applied.outcome !== "clawback_recorded") ||
      applied.applied_cents <= 0
    ) {
      continue; // replay ('already_applied') or concurrent-clamp no-op
    }
    result.entriesTouched += 1;
    result.clawbackCents += applied.applied_cents;
    emitClawbackEvent(row, input, 0, applied.applied_cents);
  }

  return result;
}

/**
 * Settled-entry reclaim: plan → reserve (DB clamps + freezes amounts) →
 * createReversal → confirm. Returns null when nothing was (or had been)
 * reclaimed for this source, or when this delivery is a pure replay.
 */
async function reclaimSettledEntry(
  ctx: EventContext,
  input: ChargeClawbackInput,
  row: ClawbackEntryRow,
): Promise<{ reversedCents: number; clawbackCents: number } | null> {
  const transferId = row.stripe_transfer_id as string;

  // Plan only on first contact; on replay/resume the reservation's stored
  // amounts are authoritative and the plan inputs are ignored by the RPC.
  let plannedReversal = 0;
  let plannedShortfall = 0;
  if (!row.source_already_applied) {
    const transfer = await ctx.stripe.transfers.retrieve(transferId);
    const reversible = Math.max(0, transfer.amount - transfer.amount_reversed);
    const plan = computeProportionalReversalCents({
      // "what was transferred" for a settled entry = the entry's allocation
      teacherShareCents: row.amount_cents,
      refundedAmountCents: input.reclaimedCents,
      chargeAmountCents: input.chargeAmountCents,
      reversibleBalanceCents: reversible,
    });
    plannedReversal = Math.min(plan.reversalCents, row.remaining_cap_cents);
    plannedShortfall = Math.min(plan.shortfallDebtCents, row.remaining_cap_cents - plannedReversal);
    if (plannedReversal <= 0 && plannedShortfall <= 0) return null;
  }

  const { data, error } = await callRpc(ctx.admin, "connect_clawback_reserve_reversal", {
    p_entry_id: row.entry_id,
    p_source_reference_id: input.sourceReferenceId,
    p_stripe_transfer_id: transferId,
    p_reversed_cents: plannedReversal,
    p_shortfall_cents: plannedShortfall,
  });
  if (error) {
    throw new Error(`clawback: reserve failed for entry ${row.entry_id}: ${error.message}`);
  }
  const reservation = (data as ReversalReservation[] | null)?.[0];
  if (!reservation || reservation.outcome === "nothing_to_reserve") {
    return null;
  }
  if (reservation.outcome === "already_reserved" && reservation.already_confirmed) {
    return null; // fully done on a prior delivery — zero additional effect
  }

  if (reservation.reversed_cents > 0) {
    const idempotencyKey = `reversal:${input.sourceReferenceId}:${transferId}`;
    const reversal = await ctx.stripe.transfers.createReversal(
      transferId,
      {
        amount: reservation.reversed_cents,
        metadata: {
          furqan_entry_id: row.entry_id,
          furqan_source_reference_id: input.sourceReferenceId,
        },
      },
      { idempotencyKey },
    );
    const { error: confErr } = await callRpc(ctx.admin, "connect_clawback_confirm_reversal", {
      p_idempotency_key: idempotencyKey,
      p_stripe_reversal_id: reversal.id,
    });
    if (confErr) {
      // The Stripe reversal EXISTS but is unconfirmed — throwing makes the
      // event fail and redeliver; the retry resumes the pending reservation.
      throw new Error(`clawback: confirm failed for entry ${row.entry_id}: ${confErr.message}`);
    }
  }

  return {
    reversedCents: reservation.reversed_cents,
    clawbackCents: reservation.shortfall_cents,
  };
}

/** Best-effort typed event + Mixpanel (Principle III: sinks never affect money). */
function emitClawbackEvent(
  row: ClawbackEntryRow,
  input: ChargeClawbackInput,
  reversedCents: number,
  clawbackCents: number,
): void {
  try {
    void emitEvent("payout.clawback", "earning_entry", row.entry_id, {
      teacher_id: row.teacher_id,
      reversed_cents: reversedCents,
      debt_cents: clawbackCents,
      source: input.source,
      source_reference_id: input.sourceReferenceId,
    }).catch((err) => {
      logError("clawback: payout.clawback emit failed", err, { tag: "connect-clawback" });
    });
    after(() =>
      trackMixpanel(row.teacher_id, MIXPANEL_EVENTS.PAYOUT_CLAWBACK, {
        reversed_cents: reversedCents,
        debt_cents: clawbackCents,
        source: input.source,
      }),
    );
  } catch (err) {
    logError("clawback: event emission failed", err, { tag: "connect-clawback" });
  }
}

/** Candidate funding_charge_id values for one charge, deduped, no nulls. */
function fundingRefs(chargeId: string | null, paymentIntentId: string | null): string[] {
  return [...new Set([chargeId, paymentIntentId].filter((r): r is string => Boolean(r)))];
}

/** Run the idempotent materialization so webhook matching never races the
 *  first sweep. Throws on failure — the event fails and redelivers. */
async function materializeLinkedEntries(ctx: EventContext): Promise<void> {
  const { error } = await callRpc(ctx.admin, "connect_materialize_session_earnings", {});
  if (error) {
    throw new Error(`clawback: materialization failed: ${error.message}`);
  }
}

/** List this source's entries across every candidate funding ref. An entry
 *  stores exactly one ref, so the per-ref result sets are disjoint; the id
 *  dedupe is belt-and-braces. */
async function listEntriesForRefs(
  ctx: EventContext,
  refs: string[],
  sourceReferenceId: string,
): Promise<ClawbackEntryRow[]> {
  const seen = new Set<string>();
  const rows: ClawbackEntryRow[] = [];
  for (const ref of refs) {
    const { data, error } = await callRpc(ctx.admin, "connect_clawback_list_entries", {
      p_funding_charge_id: ref,
      p_source_reference_id: sourceReferenceId,
    });
    if (error) {
      throw new Error(`clawback: list entries failed for ${ref}: ${error.message}`);
    }
    for (const row of (data as ClawbackEntryRow[] | null) ?? []) {
      if (seen.has(row.entry_id)) continue;
      seen.add(row.entry_id);
      rows.push(row);
    }
  }
  return rows;
}

/**
 * FR-015: move every pending/manual_due entry funded by the disputed charge
 * to held (`dispute:{id}`), and place a teacher-level payout_holds row so a
 * processing entry falling back to pending mid-dispute stays unclaimable.
 * Matching tries every candidate funding ref (charge id + payment intent id).
 * Idempotent; throws on RPC failure (event retries).
 */
export async function holdDisputedEntries(
  ctx: EventContext,
  chargeId: string | null,
  paymentIntentId: string | null,
  disputeId: string,
): Promise<number> {
  await materializeLinkedEntries(ctx);
  let held = 0;
  for (const ref of fundingRefs(chargeId, paymentIntentId)) {
    const { data, error } = await callRpc(ctx.admin, "connect_dispute_hold", {
      p_funding_charge_id: ref,
      p_dispute_id: disputeId,
    });
    if (error) {
      throw new Error(`clawback: dispute hold failed for ${disputeId}: ${error.message}`);
    }
    held += typeof data === "number" ? data : 0;
  }
  return held;
}

/** FR-015: release this dispute's own holds back to pending (won / closed-clean). */
export async function releaseDisputedEntries(
  ctx: EventContext,
  disputeId: string,
): Promise<number> {
  const { data, error } = await callRpc(ctx.admin, "connect_dispute_release", {
    p_dispute_id: disputeId,
  });
  if (error) {
    throw new Error(`clawback: dispute release failed for ${disputeId}: ${error.message}`);
  }
  return typeof data === "number" ? data : 0;
}

/** Resolve a dispute's charge id (string or expanded object). */
export function disputeChargeId(dispute: Stripe.Dispute): string | null {
  if (typeof dispute.charge === "string") return dispute.charge;
  return dispute.charge?.id ?? null;
}

/** Resolve a payment_intent reference (string or expanded object) to its id. */
export function paymentIntentIdOf(
  paymentIntent: string | { id: string } | null | undefined,
): string | null {
  if (typeof paymentIntent === "string") return paymentIntent;
  return paymentIntent?.id ?? null;
}
