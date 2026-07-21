import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { callRpc } from "@/lib/supabase/rpc";
import type {
  ClaimedEntry,
  MaterializationCounts,
  PayoutMethod,
  SweepStore,
} from "./transfer-sweep";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Spec 040 Phase 1.2 (DB half) — the production `SweepStore`, backing the pure
 * `runTransferSweep` orchestration with real Postgres via the SECURITY DEFINER
 * functions in 20260801000000_connect_sweep_functions.sql, called through the
 * typed `callRpc` seam (mirrors src/lib/domains/booking/agreement-gate.ts).
 *
 * Each method is ONE atomic RPC. The atomicity + fence guarantees live in the
 * SQL, not here: `claimEligibleEntries` is a single UPDATE …RETURNING whose
 * eligibility is evaluated inside the statement; every settlement is
 * lease-fenced (`WHERE status='processing' AND claimed_at=$lease`) and returns
 * whether it hit a row.
 *
 * Error posture — THROW, never silent-false: a `false` return from a settlement
 * RPC means the fence rejected (lease lost → abandon). A transport/DB ERROR is
 * NOT a lost lease — swallowing it as `false` would silently drop a settlement.
 * So an rpc error is logged and rethrown; the orchestrator's per-entry
 * try/catch then fails that entry CLOSED (flips it back to pending, balance
 * re-derives, the Stripe idempotency key replays the same Transfer next run).
 *
 * DORMANT: `claimEligibleEntries` returns [] until connect_cutover_date is set,
 * so every other method is unreachable in production today.
 */
export class ConnectSweepStore implements SweepStore {
  constructor(private readonly admin: AdminClient) {}

  async materializeSessionEarnings(): Promise<MaterializationCounts> {
    const { data, error } = await callRpc(this.admin, "connect_materialize_session_earnings", {});
    if (error) throw sweepRpcError("materializeSessionEarnings", error);
    const row = (data ?? [])[0];
    return {
      insertedPending: row?.inserted_pending ?? 0,
      insertedHeld: row?.inserted_held ?? 0,
      skippedInvalidAmount: row?.skipped_invalid_amount ?? 0,
      releasedStuckHolds: row?.released_stuck_holds ?? 0,
    };
  }

  async reclaimExpiredLeases(leaseCutoff: Date): Promise<number> {
    const { data, error } = await callRpc(this.admin, "connect_sweep_reclaim_expired_leases", {
      p_lease_cutoff: leaseCutoff.toISOString(),
    });
    if (error) throw sweepRpcError("reclaimExpiredLeases", error);
    return data ?? 0;
  }

  async claimEligibleEntries(now: Date): Promise<ClaimedEntry[]> {
    const { data, error } = await callRpc(this.admin, "connect_sweep_claim_eligible", {
      p_now: now.toISOString(),
    });
    if (error) throw sweepRpcError("claimEligibleEntries", error);
    return (data ?? []).map((row) => ({
      entryId: row.entry_id,
      teacherId: row.teacher_id,
      amountCents: row.amount_cents,
      outstandingDebtCents: row.outstanding_debt_cents,
      payoutMethod: row.payout_method as PayoutMethod,
      destinationAccountId: row.destination_account_id,
      transferGroup: row.transfer_group,
      currency: row.currency,
      claimedAt: new Date(row.claimed_at),
    }));
  }

  async recordDebtRecovered(input: {
    entryId: string;
    teacherId: string;
    recoveredCents: number;
    claimedAt: Date;
  }): Promise<boolean> {
    const { data, error } = await callRpc(this.admin, "connect_sweep_record_debt_recovered", {
      p_entry_id: input.entryId,
      p_teacher_id: input.teacherId,
      p_recovered_cents: input.recoveredCents,
      p_claimed_at: input.claimedAt.toISOString(),
    });
    if (error) throw sweepRpcError("recordDebtRecovered", error);
    return data === true;
  }

  async recordManualDue(input: {
    entryId: string;
    teacherId: string;
    recoveredCents: number;
    claimedAt: Date;
  }): Promise<boolean> {
    const { data, error } = await callRpc(this.admin, "connect_sweep_record_manual_due", {
      p_entry_id: input.entryId,
      p_teacher_id: input.teacherId,
      p_recovered_cents: input.recoveredCents,
      p_claimed_at: input.claimedAt.toISOString(),
    });
    if (error) throw sweepRpcError("recordManualDue", error);
    return data === true;
  }

  async recordTransferSucceeded(input: {
    entryId: string;
    teacherId: string;
    stripeTransferId: string;
    amountCents: number;
    recoveredCents: number;
    transferGroup: string | null;
    idempotencyKey: string;
    claimedAt: Date;
  }): Promise<boolean> {
    const { data, error } = await callRpc(this.admin, "connect_sweep_record_transfer_succeeded", {
      p_entry_id: input.entryId,
      p_teacher_id: input.teacherId,
      p_stripe_transfer_id: input.stripeTransferId,
      p_amount_cents: input.amountCents,
      p_recovered_cents: input.recoveredCents,
      p_transfer_group: input.transferGroup,
      p_idempotency_key: input.idempotencyKey,
      p_claimed_at: input.claimedAt.toISOString(),
    });
    if (error) throw sweepRpcError("recordTransferSucceeded", error);
    return data === true;
  }

  async recordTransferFailed(input: {
    entryId: string;
    errorDetail: string;
    claimedAt: Date;
  }): Promise<boolean> {
    // FR-011: the error is persisted ON THE ENTRY (last_error_detail) with the
    // attempt counter + backoff schedule; still no failed kind='transfer' row —
    // that would trip the teacher_transfers UNIQUE backstops on the retry.
    const { data, error } = await callRpc(this.admin, "connect_sweep_record_transfer_failed", {
      p_entry_id: input.entryId,
      p_claimed_at: input.claimedAt.toISOString(),
      p_error_detail: input.errorDetail,
    });
    if (error) throw sweepRpcError("recordTransferFailed", error);
    return data === true;
  }
}

function sweepRpcError(method: string, error: { message: string; code?: string }): Error {
  return new Error(`ConnectSweepStore.${method}: rpc failed (${error.code ?? "?"}): ${error.message}`);
}

/** Convenience factory: a store bound to a fresh service-role admin client. */
export function createConnectSweepStore(): ConnectSweepStore {
  return new ConnectSweepStore(createAdminClient());
}
