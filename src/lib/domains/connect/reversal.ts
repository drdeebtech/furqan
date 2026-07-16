// Spec 040 (Stripe Connect payouts) — refund/reversal math (FR-013).
//
// Pure, integer-cents. On charge.refunded, reverse the teacher's share of the
// refunded fraction. No Stripe, no DB — this computes the numbers; the Slice 3
// webhook handler creates the Transfer Reversal and writes the ledger rows.
//
//   raw_clawback   = floor(teacher_share * refunded_amount / charge_amount)
//   reversal       = min(raw_clawback, reversible_balance)
//   shortfall_debt = raw_clawback - reversal
//
// Round DOWN (floor) is the INVERSE of the teacher-rounds-down rule in
// src/lib/courses/revenue-split.ts: there the teacher keeps the sub-cent on the
// way in, here the platform absorbs it on the way out, so we NEVER claw back
// more than the teacher actually received. The shortfall (when the teacher was
// already paid out and the transfer can no longer be fully reversed) becomes
// negative-balance debt that FR-014 netting recovers from future earnings.

export interface ReversalInput {
  /** What the teacher was transferred for this charge, integer cents >= 0. */
  teacherShareCents: number;
  /** How much of the charge is being refunded, integer cents in [0, charge]. */
  refundedAmountCents: number;
  /** The original charge total, integer cents > 0. */
  chargeAmountCents: number;
  /** How much of the transfer can still be reversed on Stripe, integer cents >= 0. */
  reversibleBalanceCents: number;
}

export interface ReversalPlan {
  /** The Transfer Reversal amount to create on Stripe, integer cents >= 0. */
  reversalCents: number;
  /** Clawback owed beyond what was reversible → negative-balance debt, >= 0. */
  shortfallDebtCents: number;
}

function assertNonNegativeInt(value: number, name: string): void {
  // isSafeInteger (not isInteger): the clawback multiplies two of these, so an
  // input beyond 2^53 would make the product imprecise and Math.floor could
  // over-reverse by a cent. Reject unsafe magnitudes at the boundary.
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer, got ${value}`);
  }
}

export function computeProportionalReversalCents(input: ReversalInput): ReversalPlan {
  const { teacherShareCents, refundedAmountCents, chargeAmountCents, reversibleBalanceCents } =
    input;

  assertNonNegativeInt(teacherShareCents, "teacherShareCents");
  assertNonNegativeInt(refundedAmountCents, "refundedAmountCents");
  assertNonNegativeInt(reversibleBalanceCents, "reversibleBalanceCents");
  if (!Number.isInteger(chargeAmountCents) || chargeAmountCents <= 0) {
    throw new Error(`chargeAmountCents must be a positive integer, got ${chargeAmountCents}`);
  }
  if (refundedAmountCents > chargeAmountCents) {
    throw new Error(
      `refundedAmountCents (${refundedAmountCents}) cannot exceed chargeAmountCents (${chargeAmountCents})`,
    );
  }

  // Proportional clawback, rounded DOWN — the platform absorbs the sub-cent.
  // Guard the intermediate product: two safe integers can still multiply past
  // 2^53, where float imprecision would let Math.floor over-reverse by a cent.
  // A session whose share*refund exceeds this is absurd — fail loud, never
  // silently claw back more than the teacher received.
  const product = teacherShareCents * refundedAmountCents;
  if (!Number.isSafeInteger(product)) {
    throw new Error(
      `reversal overflow: teacherShareCents*refundedAmountCents (${product}) exceeds safe integer range`,
    );
  }
  const rawClawbackCents = Math.floor(product / chargeAmountCents);

  const reversalCents = Math.min(rawClawbackCents, reversibleBalanceCents);
  const shortfallDebtCents = rawClawbackCents - reversalCents;

  return { reversalCents, shortfallDebtCents };
}
