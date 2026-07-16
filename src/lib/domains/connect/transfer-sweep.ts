// Spec 040 (Stripe Connect payouts) — Phase 1 item 2: the transfer sweep.
//
// THE money-moving engine. Idempotent, fail-closed, DORMANT: nothing calls it
// yet (no cron wired). It composes the merged, already-tested domain math —
// `netEarningAgainstDebt` from ./debt (FR-014) — and orchestrates the settlement
// of already-materialized `teacher_earning_entries` rows. It does NOT derive
// earning amounts (that is ./materialize + ./earnings, upstream) and does NOT
// create refund reversals (that is ./reversal + the webhook, elsewhere).
//
// ── Concurrency & idempotency argument ──────────────────────────────────────
// The atomicity guarantee lives in ONE place: `store.claimEligibleEntries()`, a
// single SQL `UPDATE … SET status='processing', claimed_at=now()
// WHERE status='pending' AND <eligible> RETURNING …`. Eligibility (14-day hold
// from delivered_at UTC / cutover partition / payouts_enabled on the Stripe rail
// / no active payout_holds — FR-010/021/023/003) is evaluated INSIDE that
// statement, never in this code (plan Phase 1 item 2: "the condition lives inside
// the claiming statement, not in application code" — no TOCTOU). A concurrent
// sweep therefore finds no `pending` row and claims nothing: that IS the
// concurrency guarantee. Across runs, a settled entry is no longer `pending`, so
// a re-run claims it again zero times → at most one `transfers.create` per entry.
// Belt and braces: every transfer carries idempotencyKey `transfer:{entryId}`
// (FR-008), so even a crash-retry replays the SAME Stripe Transfer, and the
// teacher_transfers UNIQUE(entry_id) backstops a duplicate row.
//
// ── Debt-recovery timing (fail-closed, re-derivable) ────────────────────────
// The `debt_recovery` ledger row is written ONLY when the transfer succeeds
// (inside `recordTransferSucceeded`, atomically with the transfer row and the
// status flip). On a Stripe failure NO recovery is written, so the teacher's
// outstanding balance is untouched and the next sweep re-derives an identical
// net from `netEarningAgainstDebt` (FR-011). This is the plan's explicitly
// permitted "otherwise re-derivable" path: it reaches the same guarantee as
// write-then-reverse (a debt consumed by a failed transfer never vanishes and is
// never double-paid) with strictly fewer moving parts — no compensating
// debt_recovery_reversal is needed on the transfer-failure path at all.
// ponytail: write-on-success over write-then-reverse — same invariant, less state.

import { netEarningAgainstDebt } from "./debt";

/** How a teacher is paid: Stripe Connect transfer, or off-Stripe manual rail. */
export type PayoutMethod = "stripe_connect" | "manual";

/**
 * One entry handed back by the atomic claim — already leased (`processing`),
 * with the snapshot the settlement decision needs. `outstandingDebtCents` is
 * read inside the claim transaction so netting is consistent for this run.
 */
export interface ClaimedEntry {
  entryId: string;
  teacherId: string;
  /** The earning for this delivery, positive integer cents (already derived). */
  amountCents: number;
  /** Teacher's outstanding negative balance at claim time, integer cents >= 0. */
  outstandingDebtCents: number;
  payoutMethod: PayoutMethod;
  /** stripe_connect_accounts.stripe_account_id — required on the Stripe rail. */
  destinationAccountId: string | null;
  /** Shared with the funding charge where identifiable (FR-009); may be null. */
  transferGroup: string | null;
  /** Settlement currency. USD only (FR-012); anything else fails closed. */
  currency: string;
}

/**
 * The DB-access seam (test seam), mirroring the views/*-dashboard.ts DI style.
 * The production implementation is RPC-backed (each method one atomic SQL
 * statement / function); unit tests inject an in-memory fake. Every method that
 * moves money is a single transaction on the DB side.
 */
export interface SweepStore {
  /** Step 6 crash recovery: expired-lease `processing` rows → `pending`. Count. */
  reclaimExpiredLeases(leaseCutoff: Date): Promise<number>;
  /** Step 1: the atomic claim — lease eligible `pending` rows, return them. */
  claimEligibleEntries(now: Date): Promise<ClaimedEntry[]>;
  /** Step 2 (full consumption): write debt_recovery + close → `debt_recovered`. */
  recordDebtRecovered(input: {
    entryId: string;
    teacherId: string;
    recoveredCents: number;
  }): Promise<void>;
  /** Step 2b (manual rail): write debt_recovery if any, then → `manual_due`. */
  recordManualDue(input: {
    entryId: string;
    teacherId: string;
    recoveredCents: number;
  }): Promise<void>;
  /** Step 4 (success): write teacher_transfers (+debt_recovery if any) → `transferred`. */
  recordTransferSucceeded(input: {
    entryId: string;
    teacherId: string;
    stripeTransferId: string;
    amountCents: number;
    recoveredCents: number;
    transferGroup: string | null;
    idempotencyKey: string;
  }): Promise<void>;
  /** Step 5 (failure): `processing` → `pending`, record the error. No debt change. */
  recordTransferFailed(input: { entryId: string; errorDetail: string }): Promise<void>;
}

/** The single Stripe surface the sweep touches — structurally typed so tests mock it. */
export interface StripeTransfersApi {
  transfers: {
    create(
      params: {
        amount: number;
        currency: string;
        destination: string;
        transfer_group?: string;
      },
      options: { idempotencyKey: string },
    ): Promise<{ id: string }>;
  };
}

export interface SweepDeps {
  store: SweepStore;
  stripe: StripeTransfersApi;
  /** UTC clock, injectable for tests. Default `() => new Date()`. */
  now?: () => Date;
  /** Lease TTL before a stuck `processing` row is reclaimed. Default 15 min. */
  leaseTtlMs?: number;
  /** Structured error sink; defaults to console.error. Production passes logError. */
  logError?: (message: string, error: unknown, context?: Record<string, unknown>) => void;
}

export interface SweepResult {
  reclaimed: number;
  claimed: number;
  transferred: number;
  debtRecovered: number;
  manualDue: number;
  failed: number;
}

const DEFAULT_LEASE_TTL_MS = 15 * 60 * 1000;

function defaultLogError(message: string, error: unknown, context?: Record<string, unknown>): void {
  console.error(message, error, context);
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : JSON.stringify(error);
}

/**
 * Run one idempotent transfer sweep. Safe to run concurrently (the claim leases
 * each entry exactly once) and repeatedly (settled entries are never re-claimed).
 * Per-entry failures are isolated — one bad entry never aborts the batch.
 */
export async function runTransferSweep(deps: SweepDeps): Promise<SweepResult> {
  const { store, stripe } = deps;
  const now = deps.now ?? (() => new Date());
  const leaseTtlMs = deps.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
  const logError = deps.logError ?? defaultLogError;

  const result: SweepResult = {
    reclaimed: 0,
    claimed: 0,
    transferred: 0,
    debtRecovered: 0,
    manualDue: 0,
    failed: 0,
  };

  // Step 6: return orphaned leases to `pending` before claiming, so a crashed
  // prior run's entries become eligible again this run.
  const startedAt = now();
  result.reclaimed = await store.reclaimExpiredLeases(new Date(startedAt.getTime() - leaseTtlMs));

  // Step 1: atomic claim. Eligibility is enforced inside this call (SQL).
  const claimed = await store.claimEligibleEntries(now());
  result.claimed = claimed.length;

  for (const entry of claimed) {
    try {
      await settleEntry({ entry, store, stripe, logError, result });
    } catch (error) {
      // Defensive backstop: a store/record error must not abort the batch or
      // leave the entry silently leased — fail the entry closed and continue.
      result.failed += 1;
      logError("transfer-sweep: entry settlement failed (fail-closed → pending)", error, {
        tag: "connect",
        metadata: { entryId: entry.entryId, teacherId: entry.teacherId },
      });
      await store
        .recordTransferFailed({ entryId: entry.entryId, errorDetail: describeError(error) })
        .catch((revertError) => {
          logError("transfer-sweep: could not revert leased entry to pending", revertError, {
            tag: "connect",
            metadata: { entryId: entry.entryId },
          });
        });
    }
  }

  return result;
}

async function settleEntry(args: {
  entry: ClaimedEntry;
  store: SweepStore;
  stripe: StripeTransfersApi;
  logError: NonNullable<SweepDeps["logError"]>;
  result: SweepResult;
}): Promise<void> {
  const { entry, store, stripe, logError, result } = args;

  // Step 2: net the teacher's outstanding debt against this earning (FR-014).
  const plan = netEarningAgainstDebt({
    earningCents: entry.amountCents,
    outstandingDebtCents: entry.outstandingDebtCents,
  });

  // Fully consumed by debt → terminal, no settlement of either rail (FR-014).
  if (plan.closesAsDebtRecovered) {
    await store.recordDebtRecovered({
      entryId: entry.entryId,
      teacherId: entry.teacherId,
      recoveredCents: plan.recoveredCents,
    });
    result.debtRecovered += 1;
    return;
  }

  // Step 2b: manual rail settles off-Stripe — same hold + debt netting already
  // applied, only the settlement differs. No Stripe call, no payouts_enabled or
  // destination needed (FR-026).
  if (entry.payoutMethod === "manual") {
    await store.recordManualDue({
      entryId: entry.entryId,
      teacherId: entry.teacherId,
      recoveredCents: plan.recoveredCents,
    });
    result.manualDue += 1;
    return;
  }

  // ── Stripe rail ──
  // FR-012: USD only. A non-USD entry must never hit Stripe — fail closed.
  if (entry.currency !== "usd") {
    result.failed += 1;
    logError("transfer-sweep: non-USD entry rejected (fail-closed, FR-012)", null, {
      tag: "connect",
      metadata: { entryId: entry.entryId, currency: entry.currency },
    });
    await store.recordTransferFailed({
      entryId: entry.entryId,
      errorDetail: `non-USD currency '${entry.currency}' rejected (FR-012)`,
    });
    return;
  }

  // A Stripe-rail entry that reached the claim without a destination is a data
  // fault (payouts_enabled true but no acct id) — fail closed rather than throw.
  if (!entry.destinationAccountId) {
    result.failed += 1;
    logError("transfer-sweep: Stripe-rail entry has no destination account (fail-closed)", null, {
      tag: "connect",
      metadata: { entryId: entry.entryId, teacherId: entry.teacherId },
    });
    await store.recordTransferFailed({
      entryId: entry.entryId,
      errorDetail: "missing destination Connect account",
    });
    return;
  }

  const idempotencyKey = `transfer:${entry.entryId}`;

  // Step 3: the Stripe Transfer — OUTSIDE any DB transaction. The idempotency
  // key replays the same Transfer on any retry (FR-008).
  let stripeTransferId: string;
  try {
    const transfer = await stripe.transfers.create(
      {
        amount: plan.transferCents,
        currency: "usd",
        destination: entry.destinationAccountId,
        ...(entry.transferGroup !== null ? { transfer_group: entry.transferGroup } : {}),
      },
      { idempotencyKey },
    );
    stripeTransferId = transfer.id;
  } catch (error) {
    // Step 5 (FR-011): record the error, return the entry to `pending`. No
    // recovery was written, so the balance is unchanged and the next sweep nets
    // identically. Never mark paid, never drop.
    result.failed += 1;
    logError("transfer-sweep: stripe transfer failed (fail-closed → pending)", error, {
      tag: "connect",
      metadata: { entryId: entry.entryId, teacherId: entry.teacherId },
    });
    await store.recordTransferFailed({ entryId: entry.entryId, errorDetail: describeError(error) });
    return;
  }

  // Step 4: persist the transfer row + any debt_recovery row + flip to
  // `transferred`, atomically on the DB side.
  await store.recordTransferSucceeded({
    entryId: entry.entryId,
    teacherId: entry.teacherId,
    stripeTransferId,
    amountCents: plan.transferCents,
    recoveredCents: plan.recoveredCents,
    transferGroup: entry.transferGroup,
    idempotencyKey,
  });
  result.transferred += 1;
}
