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
// ── Lease fencing (every settlement write is conditional) ───────────────────
// Claiming a row leases it (`claimed_at` = this run's timestamp). BUT the
// process can stall: another sweep may reclaim an expired lease and re-claim the
// row (new `claimed_at`) while THIS run is still mid-flight. So every settlement
// write is FENCED to the exact lease this run holds — each port method runs
// `… WHERE entry_id=$1 AND status='processing' AND claimed_at=$lease` and reports
// whether it hit a row. 0 rows ⇒ the lease was lost to another owner ⇒ we ABANDON
// the entry: no DB side effect, and it is NOT counted as transferred/failed. The
// new owner settles it. The Stripe `transfers.create` deliberately happens BEFORE
// the fenced write; that is safe because the idempotency key `transfer:{entryId}`
// makes the new owner's replay return the SAME Transfer — the fence protects the
// DB writes, Stripe idempotency covers the external call.
//
// ── Debt-recovery timing (fail-closed, re-derivable) ────────────────────────
// The `debt_recovery` ledger row is written ONLY when the settlement succeeds
// (inside recordTransferSucceeded / recordDebtRecovered / recordManualDue,
// atomically with the status flip, under the lease fence). On a Stripe failure
// (or a lost lease) NO recovery is written, so the teacher's outstanding balance
// is untouched and the next sweep re-derives an identical net (FR-011). This is
// the plan's explicitly permitted "otherwise re-derivable" path: same guarantee
// as write-then-reverse (a debt consumed by a failed transfer never vanishes and
// is never double-paid) with strictly fewer moving parts.
// ponytail: write-on-success over write-then-reverse — same invariant, less state.
//
// ── Per-teacher running balance (no double-recovery within a batch) ─────────
// Two entries for the SAME teacher share one claim-time `outstandingDebtCents`
// snapshot. Netting both against that snapshot would recover the debt twice. So
// the run keeps a per-teacher RUNNING balance: seeded from the snapshot, then
// decremented by each recovery actually committed, so the second entry nets
// against the debt the first already paid down. A teacher's entries are processed
// sequentially against that running balance.

import { netEarningAgainstDebt } from "./debt";

/** How a teacher is paid: Stripe Connect transfer, or off-Stripe manual rail. */
export type PayoutMethod = "stripe_connect" | "manual";

/**
 * One entry handed back by the atomic claim — already leased (`processing`),
 * with the snapshot the settlement decision needs. `outstandingDebtCents` is
 * read inside the claim transaction so netting is consistent for this run.
 * `claimedAt` is the lease token: the `claimed_at` this run's claim set, threaded
 * into every settlement write so a stolen lease cannot double-settle the entry.
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
  /** Lease token — the `claimed_at` this run set. Fences every settlement write. */
  claimedAt: Date;
}

/**
 * The DB-access seam (test seam), mirroring the views/*-dashboard.ts DI style.
 * The production implementation is RPC-backed (each method one atomic SQL
 * statement / function); unit tests inject an in-memory fake. Every method that
 * moves money is a single transaction on the DB side.
 *
 * Every settlement method is LEASE-FENCED: its SQL carries
 * `… WHERE entry_id=$1 AND status='processing' AND claimed_at=$lease` and returns
 * `true` iff it updated a row. `false` ⇒ the lease was reclaimed by another sweep
 * ⇒ the caller must perform no side effect and not count the entry.
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
    claimedAt: Date;
  }): Promise<boolean>;
  /** Step 2b (manual rail): write debt_recovery if any, then → `manual_due`. */
  recordManualDue(input: {
    entryId: string;
    teacherId: string;
    recoveredCents: number;
    claimedAt: Date;
  }): Promise<boolean>;
  /** Step 4 (success): write teacher_transfers (+debt_recovery if any) → `transferred`. */
  recordTransferSucceeded(input: {
    entryId: string;
    teacherId: string;
    stripeTransferId: string;
    amountCents: number;
    recoveredCents: number;
    transferGroup: string | null;
    idempotencyKey: string;
    claimedAt: Date;
  }): Promise<boolean>;
  /** Step 5 (failure): `processing` → `pending`, record the error. No debt change. */
  recordTransferFailed(input: {
    entryId: string;
    errorDetail: string;
    claimedAt: Date;
  }): Promise<boolean>;
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
  /**
   * Best-effort typed payout event sink (plan Phase 1 item 6): called after a
   * settlement write LANDS (fenced write returned true) — transferred and
   * failed outcomes only. A throw is logged and swallowed (safeEmit); it can
   * never fail or delay a settlement decision. Production wires this to
   * emitEvent + trackMixpanel; tests inject a recorder.
   */
  emitPayoutEvent?: (event: PayoutSweepEvent) => Promise<void> | void;
}

export interface SweepResult {
  reclaimed: number;
  claimed: number;
  transferred: number;
  debtRecovered: number;
  manualDue: number;
  failed: number;
  /** Entries whose lease was lost mid-run (fence rejected the write). Not paid. */
  abandoned: number;
}

/** The single terminal outcome of settling one claimed entry. Counted once. */
type SettleOutcome = "transferred" | "debtRecovered" | "manualDue" | "failed" | "abandoned";

/**
 * Typed payout lifecycle events (spec 040 plan Phase 1 item 6), surfaced
 * best-effort AFTER a settlement write lands — never for an abandoned entry
 * (the lease's new owner emits when they settle). `payout.clawback` is emitted
 * by the refund/dispute webhook path (Phase 3), not the sweep.
 */
export type PayoutSweepEvent =
  | {
      type: "payout.transfer_created";
      entryId: string;
      teacherId: string;
      /** The NET amount actually transferred (post debt netting). */
      transferCents: number;
      recoveredCents: number;
      stripeTransferId: string;
    }
  | {
      type: "payout.transfer_failed";
      entryId: string;
      teacherId: string;
      errorDetail: string;
    };

// 2× the suggested 15-min cron cadence: a run slower than one interval must
// NOT have its unprocessed leases deterministically stolen by the next run
// (review finding — TTL == cadence leaves zero headroom).
const DEFAULT_LEASE_TTL_MS = 30 * 60 * 1000;

function defaultLogError(message: string, error: unknown, context?: Record<string, unknown>): void {
  console.error(message, error, context);
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : JSON.stringify(error);
}

/** Best-effort emit: a throwing event sink must never affect settlement
 *  (constitution Principle III — notifications/analytics can never fail a
 *  payout). A throw is logged and swallowed HERE, the one sanctioned place. */
async function safeEmit(
  emit: SweepDeps["emitPayoutEvent"],
  logError: NonNullable<SweepDeps["logError"]>,
  event: PayoutSweepEvent,
): Promise<void> {
  if (!emit) return;
  try {
    await emit(event);
  } catch (error) {
    logError("transfer-sweep: payout event emit failed (best-effort)", error, {
      tag: "connect",
      metadata: { entryId: event.entryId, type: event.type },
    });
  }
}

/**
 * Run one idempotent transfer sweep. Safe to run concurrently (the claim leases
 * each entry exactly once and every settlement is lease-fenced) and repeatedly
 * (settled entries are never re-claimed). Per-entry failures are isolated — one
 * bad entry never aborts the batch — and each entry is counted exactly once.
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
    abandoned: 0,
  };

  // Step 6: return orphaned leases to `pending` before claiming, so a crashed
  // prior run's entries become eligible again this run.
  const startedAt = now();
  result.reclaimed = await store.reclaimExpiredLeases(new Date(startedAt.getTime() - leaseTtlMs));

  // Step 1: atomic claim. Eligibility is enforced inside this call (SQL).
  const claimed = await store.claimEligibleEntries(now());
  result.claimed = claimed.length;

  // Per-teacher running debt so two entries for one teacher don't both net
  // against the same claim-time snapshot (double-recovery). Seeded lazily from
  // the first entry's snapshot; decremented only when a recovery is committed.
  const runningDebtCents = new Map<string, number>();

  for (const entry of claimed) {
    let outcome: SettleOutcome;
    try {
      outcome = await settleEntry({
        entry,
        store,
        stripe,
        logError,
        runningDebtCents,
        emit: deps.emitPayoutEvent,
      });
    } catch (error) {
      // Defensive backstop: an unexpected store/record error must not abort the
      // batch or leave the entry silently leased — fail the entry closed (fenced)
      // and continue. If the fence rejects (lease lost), abandon instead.
      logError("transfer-sweep: entry settlement failed (fail-closed → pending)", error, {
        tag: "connect",
        metadata: { entryId: entry.entryId, teacherId: entry.teacherId },
      });
      const reverted = await store
        .recordTransferFailed({
          entryId: entry.entryId,
          errorDetail: describeError(error),
          claimedAt: entry.claimedAt,
        })
        .catch((revertError) => {
          logError("transfer-sweep: could not revert leased entry to pending", revertError, {
            tag: "connect",
            metadata: { entryId: entry.entryId },
          });
          return false;
        });
      // Only the Stripe rail means "a transfer failed" — a manual-rail entry's
      // settlement error must not surface as payout.transfer_failed (review
      // finding: n8n would tell a manual-rail teacher their transfer failed
      // when no Stripe call was ever intended).
      if (reverted && entry.payoutMethod === "stripe_connect") {
        await safeEmit(deps.emitPayoutEvent, logError, {
          type: "payout.transfer_failed",
          entryId: entry.entryId,
          teacherId: entry.teacherId,
          errorDetail: describeError(error),
        });
      }
      outcome = reverted ? "failed" : "abandoned";
    }

    // Exactly one increment per entry.
    result[outcome] += 1;
  }

  return result;
}

async function settleEntry(args: {
  entry: ClaimedEntry;
  store: SweepStore;
  stripe: StripeTransfersApi;
  logError: NonNullable<SweepDeps["logError"]>;
  runningDebtCents: Map<string, number>;
  emit: SweepDeps["emitPayoutEvent"];
}): Promise<SettleOutcome> {
  const { entry, store, stripe, logError, runningDebtCents, emit } = args;

  // Step 2: net against the teacher's RUNNING debt (seeded from the claim-time
  // snapshot the first time we touch this teacher this run), so a sibling entry
  // for the same teacher nets against the debt already paid down (FR-014).
  const debtNow = runningDebtCents.has(entry.teacherId)
    ? runningDebtCents.get(entry.teacherId)!
    : entry.outstandingDebtCents;
  const plan = netEarningAgainstDebt({
    earningCents: entry.amountCents,
    outstandingDebtCents: debtNow,
  });

  // Fully consumed by debt → terminal, no settlement of either rail (FR-014).
  if (plan.closesAsDebtRecovered) {
    const applied = await store.recordDebtRecovered({
      entryId: entry.entryId,
      teacherId: entry.teacherId,
      recoveredCents: plan.recoveredCents,
      claimedAt: entry.claimedAt,
    });
    if (!applied) return "abandoned";
    runningDebtCents.set(entry.teacherId, plan.remainingDebtCents);
    return "debtRecovered";
  }

  // Step 2b: manual rail settles off-Stripe — same hold + debt netting already
  // applied, only the settlement differs. No Stripe call, no payouts_enabled or
  // destination needed (FR-026).
  if (entry.payoutMethod === "manual") {
    const applied = await store.recordManualDue({
      entryId: entry.entryId,
      teacherId: entry.teacherId,
      recoveredCents: plan.recoveredCents,
      claimedAt: entry.claimedAt,
    });
    if (!applied) return "abandoned";
    runningDebtCents.set(entry.teacherId, plan.remainingDebtCents);
    return "manualDue";
  }

  // ── Stripe rail ──
  // FR-012: USD only. A non-USD entry must never hit Stripe — fail closed.
  if (entry.currency !== "usd") {
    logError("transfer-sweep: non-USD entry rejected (fail-closed, FR-012)", null, {
      tag: "connect",
      metadata: { entryId: entry.entryId, currency: entry.currency },
    });
    const applied = await store.recordTransferFailed({
      entryId: entry.entryId,
      errorDetail: `non-USD currency '${entry.currency}' rejected (FR-012)`,
      claimedAt: entry.claimedAt,
    });
    if (applied) {
      await safeEmit(emit, logError, {
        type: "payout.transfer_failed",
        entryId: entry.entryId,
        teacherId: entry.teacherId,
        errorDetail: `non-USD currency '${entry.currency}' rejected (FR-012)`,
      });
    }
    return applied ? "failed" : "abandoned";
  }

  // A Stripe-rail entry that reached the claim without a destination is a data
  // fault (payouts_enabled true but no acct id) — fail closed rather than throw.
  if (!entry.destinationAccountId) {
    logError("transfer-sweep: Stripe-rail entry has no destination account (fail-closed)", null, {
      tag: "connect",
      metadata: { entryId: entry.entryId, teacherId: entry.teacherId },
    });
    const applied = await store.recordTransferFailed({
      entryId: entry.entryId,
      errorDetail: "missing destination Connect account",
      claimedAt: entry.claimedAt,
    });
    if (applied) {
      await safeEmit(emit, logError, {
        type: "payout.transfer_failed",
        entryId: entry.entryId,
        teacherId: entry.teacherId,
        errorDetail: "missing destination Connect account",
      });
    }
    return applied ? "failed" : "abandoned";
  }

  const idempotencyKey = `transfer:${entry.entryId}`;

  // Step 3: the Stripe Transfer — OUTSIDE any DB transaction, BEFORE the fenced
  // write. The idempotency key replays the same Transfer on any retry (FR-008),
  // so even if our lease was stolen the new owner's replay returns this Transfer.
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
    // Step 5 (FR-011): record the error, return the entry to `pending` (fenced).
    // No recovery was written, so the balance is unchanged and the next sweep
    // nets identically. Never mark paid, never drop.
    logError("transfer-sweep: stripe transfer failed (fail-closed → pending)", error, {
      tag: "connect",
      metadata: { entryId: entry.entryId, teacherId: entry.teacherId },
    });
    const applied = await store.recordTransferFailed({
      entryId: entry.entryId,
      errorDetail: describeError(error),
      claimedAt: entry.claimedAt,
    });
    if (applied) {
      await safeEmit(emit, logError, {
        type: "payout.transfer_failed",
        entryId: entry.entryId,
        teacherId: entry.teacherId,
        errorDetail: describeError(error),
      });
    }
    return applied ? "failed" : "abandoned";
  }

  // Step 4: persist the transfer row + any debt_recovery row + flip to
  // `transferred`, atomically and lease-fenced on the DB side. A lost lease here
  // means another owner already owns the entry — abandon (Stripe idempotency
  // guarantees their replay reuses this same Transfer, no double pay).
  const applied = await store.recordTransferSucceeded({
    entryId: entry.entryId,
    teacherId: entry.teacherId,
    stripeTransferId,
    amountCents: plan.transferCents,
    recoveredCents: plan.recoveredCents,
    transferGroup: entry.transferGroup,
    idempotencyKey,
    claimedAt: entry.claimedAt,
  });
  if (!applied) return "abandoned";
  runningDebtCents.set(entry.teacherId, plan.remainingDebtCents);
  await safeEmit(emit, logError, {
    type: "payout.transfer_created",
    entryId: entry.entryId,
    teacherId: entry.teacherId,
    transferCents: plan.transferCents,
    recoveredCents: plan.recoveredCents,
    stripeTransferId,
  });
  return "transferred";
}
