// Spec 040 (Stripe Connect payouts) — teacher debt math (FR-014).
//
// Pure, integer-cents, reconstructable from the ledger alone. No Stripe, no DB,
// no clock. The signed-ledger convention is defined ONCE in the migration header
// of 20260728000000_connect_earnings_ledger.sql and mirrored here:
//
//   session / course              → positive (earning)   — NOT part of the debt sum
//   clawback                      → negative (debt created)
//   debt_recovery                 → positive (debt paid down)
//   debt_recovery_reversal        → negative (recovery undone, debt restored)
//
//   outstanding_debt_cents =
//     GREATEST(0, -1 * SUM(amount_cents) WHERE kind IN
//       ('clawback','debt_recovery','debt_recovery_reversal'))

export type DebtLedgerKind =
  | "session"
  | "course"
  | "clawback"
  | "debt_recovery"
  | "debt_recovery_reversal";

export interface DebtLedgerRow {
  kind: DebtLedgerKind;
  amountCents: number;
}

export type ConnectDebtErrorReason = "invalid_earning" | "invalid_debt";

// Mirrors ConnectEarningError's posture (src/lib/domains/connect/earnings.ts):
// an invalid input is a structured, reason-coded exception the Slice-3 sweep can
// branch on — never a silent miscalculation.
export class ConnectDebtError extends Error {
  readonly reason: ConnectDebtErrorReason;

  constructor(reason: ConnectDebtErrorReason, message: string) {
    super(message);
    this.name = "ConnectDebtError";
    this.reason = reason;
  }
}

// The three kinds that move debt. Earnings (session/course) are excluded — they
// are what PAYS debt via netEarningAgainstDebt, not the debt itself.
const DEBT_KINDS: ReadonlySet<DebtLedgerKind> = new Set([
  "clawback",
  "debt_recovery",
  "debt_recovery_reversal",
]);

export function computeOutstandingDebtCents(rows: readonly DebtLedgerRow[]): number {
  const signedSum = rows.reduce(
    (acc, r) => (DEBT_KINDS.has(r.kind) ? acc + r.amountCents : acc),
    0,
  );
  // Floored at 0: over-recovery is a credit we do not track as negative debt.
  return Math.max(0, -1 * signedSum);
}

export interface NetEarningInput {
  /** The claimed earning for this delivery, integer cents >= 0. */
  earningCents: number;
  /** Outstanding debt from computeOutstandingDebtCents, integer cents >= 0. */
  outstandingDebtCents: number;
}

export interface NetEarningPlan {
  /** What actually transfers to the teacher via Stripe. 0 ⇒ no Stripe call. */
  transferCents: number;
  /** Debt paid down by this earning — the debt_recovery row to append. */
  recoveredCents: number;
  /** Debt still owed after this offset, carried forward. */
  remainingDebtCents: number;
  /** True ⇒ the earning was consumed ENTIRELY by debt (`transferCents === 0`),
   *  so the entry closes as `debt_recovered` (terminal, non-paying). A PARTIAL
   *  offset still transfers the remainder and closes as `transferred`, so this
   *  stays `false` there. */
  closesAsDebtRecovered: boolean;
}

// FR-014: net the teacher's outstanding debt against a claimed earning.
//   transfer_cents = max(0, earning_cents - outstanding_debt_cents)
// Returns a PLAN describing the rows the atomic claim must write; it never
// writes and reads no clock, so a replayed sweep with the same ledger state
// produces the same plan (idempotent by construction).
export function netEarningAgainstDebt(input: NetEarningInput): NetEarningPlan {
  const { earningCents, outstandingDebtCents } = input;

  if (!Number.isInteger(earningCents) || earningCents < 0) {
    throw new ConnectDebtError(
      "invalid_earning",
      `earningCents must be a non-negative integer, got ${earningCents}`,
    );
  }
  if (!Number.isInteger(outstandingDebtCents) || outstandingDebtCents < 0) {
    throw new ConnectDebtError(
      "invalid_debt",
      `outstandingDebtCents must be a non-negative integer, got ${outstandingDebtCents}`,
    );
  }

  const recoveredCents = Math.min(earningCents, outstandingDebtCents);
  const transferCents = earningCents - recoveredCents;
  const remainingDebtCents = outstandingDebtCents - recoveredCents;

  return {
    transferCents,
    recoveredCents,
    remainingDebtCents,
    // FR-014: `debt_recovered` is terminal ONLY when the earning is consumed
    // ENTIRELY (transfer_cents == 0). A partial offset still transfers the
    // remainder, so that entry closes as `transferred`, not `debt_recovered`.
    closesAsDebtRecovered: transferCents === 0 && recoveredCents > 0,
  };
}
