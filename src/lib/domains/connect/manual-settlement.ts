import { z } from "zod";

// Spec 040 Phase 1 (item 5) — manual-rail settlement (FR-027), the off-Stripe
// analogue of a Transfer Record. The #716 sweep flips a manual-rail entry
// processing → manual_due; this closes it manual_due → manual_paid with an
// external reference, actor, and timestamp.
//
// This module owns the INPUT contract + orchestration ONLY. The money-integrity
// guarantees are in the SQL (connect_settle_manual_due), proven by the
// rolled-back walk scripts/walk-040-manual-settlement.sql:
//   * single conditional UPDATE (WHERE status='manual_due' AND the teacher's
//     payout_method='manual') — can NEVER touch a stripe_connect entry;
//   * replay is a no-op (a second call finds status='manual_paid', not
//     'manual_due', so the fenced UPDATE hits zero rows → false);
//   * settled_by / settled_at / external_reference_id set atomically with the
//     status flip (chk_entry_manual_settlement enforces all-or-nothing).
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
const manualSettlementSchema = z.object({
  entryId: z.uuid(),
  referenceId: z.string().trim().min(1),
  settlingAdmin: z.uuid(),
});

export type ManualSettlementInput = z.input<typeof manualSettlementSchema>;
export type ManualSettlementValues = z.output<typeof manualSettlementSchema>;

export interface ManualSettlementResult {
  /** True if this call settled the entry; false if the conditional update hit
   *  nothing (replay, wrong status, or a refused stripe_connect entry). */
  settled: boolean;
}

/**
 * The port: one atomic conditional RPC. `false` means the fenced UPDATE hit zero
 * rows (replay / wrong status / stripe_connect refusal) — a legitimate no-op,
 * NOT an error. A transport/DB error is thrown by the adapter, never coerced to
 * false (mirrors ConnectSweepStore's throw-never-silent-false posture).
 */
export interface ManualSettlementStore {
  settleManualDue(input: ManualSettlementValues): Promise<boolean>;
}

/**
 * Validate, trim, and settle one manual-rail entry. Fail-closed: a bad shape or
 * blank reference throws BEFORE the store is touched, so a caller contract
 * breach can never reach the ledger.
 */
export async function settleManualPayout(
  store: ManualSettlementStore,
  input: ManualSettlementInput,
): Promise<ManualSettlementResult> {
  const parsed = manualSettlementSchema.safeParse(input);
  if (!parsed.success) {
    throw new ManualSettlementError("invalid_input", parsed.error.issues[0]?.message ?? "invalid input");
  }
  const settled = await store.settleManualDue(parsed.data);
  return { settled };
}
