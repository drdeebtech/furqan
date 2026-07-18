import { z } from "zod";

// Spec 040 Phase 1 (item 5) + FR-027a — manual-rail settlement, the off-Stripe
// analogue of a Transfer Record. The sweep flips a manual-rail entry
// processing → manual_due; this closes it at its NET value with settle-time
// debt netting (FR-014 binds the manual rail too).
//
// This module owns the INPUT contract + orchestration ONLY. The money-integrity
// guarantees live in the SQL (connect_settle_manual_due, migration 20260811),
// proven by the rolled-back walks:
//   * the entry is locked at status='manual_due' with the teacher's
//     payout_method='manual' — it can NEVER touch a stripe_connect entry;
//   * outstanding debt is re-derived at the settle serialization point and the
//     caller's expectedNetCents acts as an optimistic fence: a mismatch (e.g. a
//     clawback landed while the entry sat in the queue) refuses with the fresh
//     number and writes NOTHING ('stale_net');
//   * net = 0 closes the entry as debt_recovered (no payment, no reference);
//   * an active teacher-level payout hold refuses the settle ('teacher_on_hold');
//   * replay finds the fence closed → 'not_found', a legitimate no-op.
//
// Admin identity is taken from the authenticated session at the action boundary
// (Phase 4 thin shell), never from input — this module receives the resolved
// admin id and validates its shape.

export type ManualSettlementErrorReason = "invalid_input";

export class ManualSettlementError extends Error {
  readonly reason: ManualSettlementErrorReason;

  constructor(reason: ManualSettlementErrorReason, message: string) {
    super(message);
    this.name = "ManualSettlementError";
    this.reason = reason;
  }
}

// z.string().trim().min(1): trim FIRST so "   " collapses to "" and is rejected
// — never store whitespace as the evidence that money left the building.
// referenceId is REQUIRED whenever money moves (expectedNetCents > 0); the
// zero-net close pays nothing, so no reference exists — allow its absence there.
const manualSettlementSchema = z
  .object({
    entryId: z.uuid(),
    referenceId: z.string().trim().min(1).nullish(),
    settlingAdmin: z.uuid(),
    expectedNetCents: z.number().int().min(0),
  })
  .refine((v) => v.expectedNetCents === 0 || (v.referenceId ?? "").length > 0, {
    message: "referenceId is required when expectedNetCents > 0",
    path: ["referenceId"],
  });

export type ManualSettlementInput = z.input<typeof manualSettlementSchema>;
export type ManualSettlementValues = z.output<typeof manualSettlementSchema>;

/**
 * The SQL's typed outcome (jsonb), surfaced verbatim — every branch is a
 * decision the admin UI must render distinctly, never a boolean collapse:
 *   settled                → manual_paid at netPaidCents (recoveredCents netted)
 *   closed_debt_recovered  → net was 0; entry closed, nothing paid
 *   stale_net              → fence refused; netDueCents is the FRESH number
 *   teacher_on_hold        → an active payout hold binds the manual rail too
 *   not_found              → replay / wrong status / wrong rail — legit no-op
 */
export type ManualSettlementOutcome =
  | { outcome: "settled"; netPaidCents: number; recoveredCents: number }
  | { outcome: "closed_debt_recovered"; recoveredCents: number }
  | { outcome: "stale_net"; netDueCents: number }
  | { outcome: "teacher_on_hold" }
  | { outcome: "not_found" };

/**
 * The port: one atomic conditional RPC. Refusals come back as typed outcomes —
 * never coerced to a boolean. A transport/DB error is thrown by the adapter
 * (mirrors ConnectSweepStore's throw-never-silent posture).
 */
export interface ManualSettlementStore {
  settleManualDue(input: ManualSettlementValues): Promise<ManualSettlementOutcome>;
}

/**
 * Validate, trim, and settle one manual-rail entry at its expected net. Fail
 * closed: a bad shape, a blank reference with money moving, or a negative
 * expected net throws BEFORE the store is touched, so a caller contract breach
 * can never reach the ledger.
 */
export async function settleManualPayout(
  store: ManualSettlementStore,
  input: ManualSettlementInput,
): Promise<ManualSettlementOutcome> {
  const parsed = manualSettlementSchema.safeParse(input);
  if (!parsed.success) {
    throw new ManualSettlementError("invalid_input", parsed.error.issues[0]?.message ?? "invalid input");
  }
  return store.settleManualDue(parsed.data);
}
