import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  runTransferSweep,
  type ClaimedEntry,
  type SweepStore,
  type StripeTransfersApi,
  type PayoutSweepEvent,
} from "./transfer-sweep";

// ─────────────────────────────────────────────────────────────────────────
// In-memory fake SweepStore — the executable spec of the DB-access seam.
//
// The REAL store's claimEligibleEntries() is a single atomic SQL UPDATE whose
// eligibility (14-day hold from delivered_at, cutover partition, payouts_enabled
// for the Stripe rail, no active payout_holds) is evaluated INSIDE the statement
// (plan Phase 1 item 2 / FR-010/021/023) — that SQL is verified at the DB level
// in the wiring slice. This fake mirrors that predicate so these unit tests prove
// the ENGINE never acts on anything the claim did not hand it, and that the
// per-entry money decisions (debt netting, manual rail, failure, lease fence)
// are correct.
//
// LEASE FENCE: every settlement method here enforces the same
// `status='processing' AND claimed_at=$lease` guard the real SQL will — a write
// whose lease no longer matches the stored `claimed_at` hits 0 rows and returns
// false (the entry was reclaimed by another sweep).
// ─────────────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

type Rail = "stripe_connect" | "manual";

interface TeacherState {
  outstandingDebtCents: number;
  payoutMethod: Rail;
  payoutsEnabled: boolean;
  destinationAccountId: string | null;
}

interface EntryState {
  entryId: string;
  teacherId: string;
  amountCents: number;
  deliveredAt: Date;
  transferGroup: string | null;
  currency: string;
  status: string;
  claimedAt: Date | null;
  errorDetail: string | null;
}

interface TransferRow {
  entryId: string;
  teacherId: string;
  stripeTransferId: string;
  amountCents: number;
  recoveredCents: number;
  idempotencyKey: string;
}

class FakeStore implements SweepStore {
  teachers = new Map<string, TeacherState>();
  entries = new Map<string, EntryState>();
  activeHolds = new Set<string>();
  transfers: TransferRow[] = [];
  holdDays = 14;
  cutoverDate: Date | null = new Date("2026-01-01T00:00:00Z");

  // Step 0 (materialization) knobs: what the RPC would report, whether it
  // should crash, and an order probe (claim must run after materialize).
  materializeResult = {
    insertedPending: 0,
    insertedHeld: 0,
    skippedInvalidAmount: 0,
    releasedStuckHolds: 0,
  };
  materializeError: Error | null = null;
  materializeCalls = 0;
  claimCalledBeforeMaterialize = false;

  async materializeSessionEarnings() {
    this.materializeCalls += 1;
    if (this.materializeError) throw this.materializeError;
    return this.materializeResult;
  }

  seedTeacher(id: string, s: Partial<TeacherState> = {}): void {
    this.teachers.set(id, {
      outstandingDebtCents: 0,
      payoutMethod: "stripe_connect",
      payoutsEnabled: true,
      destinationAccountId: "acct_default",
      ...s,
    });
  }

  seedEntry(e: Partial<EntryState> & { entryId: string; teacherId: string; amountCents: number }): void {
    this.entries.set(e.entryId, {
      deliveredAt: new Date("2026-06-01T00:00:00Z"),
      transferGroup: `tg_${e.entryId}`,
      currency: "usd",
      status: "pending",
      claimedAt: null,
      errorDetail: null,
      ...e,
    });
  }

  outstandingDebt(teacherId: string): number {
    return this.teachers.get(teacherId)?.outstandingDebtCents ?? 0;
  }

  totalRecovered(): number {
    return this.transfers.reduce((acc, t) => acc + t.recoveredCents, 0);
  }

  // The lease fence: the write only lands if the entry is still `processing` and
  // still carries the exact `claimed_at` this run leased. Returns rows-affected>0.
  private fenced(entryId: string, lease: Date): EntryState | null {
    const entry = this.entries.get(entryId);
    if (!entry) return null;
    if (entry.status !== "processing") return null;
    if (entry.claimedAt === null || entry.claimedAt.getTime() !== lease.getTime()) return null;
    return entry;
  }

  async reclaimExpiredLeases(leaseCutoff: Date): Promise<number> {
    let n = 0;
    for (const entry of this.entries.values()) {
      if (entry.status === "processing" && entry.claimedAt !== null && entry.claimedAt < leaseCutoff) {
        entry.status = "pending";
        entry.claimedAt = null;
        n += 1;
      }
    }
    return n;
  }

  async claimEligibleEntries(now: Date): Promise<ClaimedEntry[]> {
    if (this.materializeCalls === 0) this.claimCalledBeforeMaterialize = true;
    const claimed: ClaimedEntry[] = [];
    for (const entry of this.entries.values()) {
      if (entry.status !== "pending") continue;
      const t = this.teachers.get(entry.teacherId);
      if (!t) continue;
      // Cutover partition (FR-021): before the cutover date, nothing accrues here.
      if (this.cutoverDate === null || entry.deliveredAt < this.cutoverDate) continue;
      // 14-day hold from delivered_at, UTC (FR-010).
      if (entry.deliveredAt.getTime() + this.holdDays * DAY_MS > now.getTime()) continue;
      // Active payout hold blocks the sweep for that teacher (FR-023).
      if (this.activeHolds.has(entry.teacherId)) continue;
      // Stripe rail requires payouts_enabled; the manual rail never does (FR-026).
      if (t.payoutMethod === "stripe_connect" && !t.payoutsEnabled) continue;

      // Lease the row. `new Date(now)` so the token is a distinct object we can
      // later mutate away from (simulating a stolen lease) without touching this.
      const lease = new Date(now.getTime());
      entry.status = "processing";
      entry.claimedAt = lease;
      claimed.push({
        entryId: entry.entryId,
        teacherId: entry.teacherId,
        amountCents: entry.amountCents,
        outstandingDebtCents: t.outstandingDebtCents,
        payoutMethod: t.payoutMethod,
        destinationAccountId: t.destinationAccountId,
        transferGroup: entry.transferGroup,
        currency: entry.currency,
        claimedAt: lease,
      });
    }
    return claimed;
  }

  async recordDebtRecovered(input: {
    entryId: string;
    teacherId: string;
    recoveredCents: number;
    claimedAt: Date;
  }): Promise<boolean> {
    const entry = this.fenced(input.entryId, input.claimedAt);
    if (!entry) return false;
    entry.status = "debt_recovered";
    this.teachers.get(input.teacherId)!.outstandingDebtCents -= input.recoveredCents;
    return true;
  }

  async recordManualDue(input: {
    entryId: string;
    teacherId: string;
    recoveredCents: number;
    claimedAt: Date;
  }): Promise<boolean> {
    const entry = this.fenced(input.entryId, input.claimedAt);
    if (!entry) return false;
    entry.status = "manual_due";
    this.teachers.get(input.teacherId)!.outstandingDebtCents -= input.recoveredCents;
    return true;
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
    const entry = this.fenced(input.entryId, input.claimedAt);
    if (!entry) return false;
    entry.status = "transferred";
    this.teachers.get(input.teacherId)!.outstandingDebtCents -= input.recoveredCents;
    this.transfers.push({
      entryId: input.entryId,
      teacherId: input.teacherId,
      stripeTransferId: input.stripeTransferId,
      amountCents: input.amountCents,
      recoveredCents: input.recoveredCents,
      idempotencyKey: input.idempotencyKey,
    });
    return true;
  }

  async recordTransferFailed(input: {
    entryId: string;
    errorDetail: string;
    claimedAt: Date;
  }): Promise<boolean> {
    const entry = this.fenced(input.entryId, input.claimedAt);
    if (!entry) return false;
    entry.status = "pending";
    entry.claimedAt = null;
    entry.errorDetail = input.errorDetail;
    return true;
  }
}

function makeStripe(): StripeTransfersApi & { create: ReturnType<typeof vi.fn> } {
  const create = vi.fn(
    async (
      _params: { amount: number; currency: string; destination: string; transfer_group?: string },
      opts: { idempotencyKey: string },
    ) => ({ id: `tr_${opts.idempotencyKey}` }),
  );
  return { transfers: { create }, create } as StripeTransfersApi & { create: ReturnType<typeof vi.fn> };
}

// A time well past every seeded delivery's 14-day hold.
const NOW = () => new Date("2026-07-16T00:00:00Z");

describe("runTransferSweep", () => {
  let store: FakeStore;
  let stripe: StripeTransfersApi & { create: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    store = new FakeStore();
    stripe = makeStripe();
  });

  it("creates exactly one Stripe transfer for an eligible entry, and is a no-op on replay (idempotency, FR-008)", async () => {
    store.seedTeacher("t1");
    store.seedEntry({ entryId: "e1", teacherId: "t1", amountCents: 5000 });

    const first = await runTransferSweep({ store, stripe, now: NOW });
    expect(stripe.create).toHaveBeenCalledTimes(1);
    expect(first.transferred).toBe(1);
    expect(store.entries.get("e1")!.status).toBe("transferred");

    const second = await runTransferSweep({ store, stripe, now: NOW });
    expect(stripe.create).toHaveBeenCalledTimes(1); // still one — no double pay
    expect(second.claimed).toBe(0);
  });

  it("passes the entry-scoped idempotency key transfer:{entryId} and usd currency (FR-008/009/012)", async () => {
    store.seedTeacher("t1", { destinationAccountId: "acct_x" });
    store.seedEntry({ entryId: "e1", teacherId: "t1", amountCents: 5000, transferGroup: "tg_charge_1" });

    await runTransferSweep({ store, stripe, now: NOW });

    expect(stripe.create).toHaveBeenCalledWith(
      { amount: 5000, currency: "usd", destination: "acct_x", transfer_group: "tg_charge_1" },
      { idempotencyKey: "transfer:e1" },
    );
  });

  describe("materialization step 0 (spec 040 wiring slice)", () => {
    it("runs materialization BEFORE the claim and reports the derived count", async () => {
      store.materializeResult = {
        insertedPending: 2,
        insertedHeld: 1,
        skippedInvalidAmount: 0,
        releasedStuckHolds: 0,
      };
      const r = await runTransferSweep({ store, stripe, now: NOW });
      expect(store.materializeCalls).toBe(1);
      expect(store.claimCalledBeforeMaterialize).toBe(false);
      expect(r.materialized).toBe(3);
      expect(r.materializationFailed).toBe(false);
    });

    it("a materialization crash is isolated: logged, flagged, and the run still settles existing entries", async () => {
      const logError = vi.fn();
      store.materializeError = new Error("db down");
      store.seedTeacher("t1");
      store.seedEntry({ entryId: "e1", teacherId: "t1", amountCents: 5000 });

      const r = await runTransferSweep({ store, stripe, now: NOW, logError });

      expect(r.materializationFailed).toBe(true);
      expect(r.materialized).toBe(0);
      expect(r.transferred).toBe(1); // pre-existing entry still paid
      expect(logError).toHaveBeenCalledWith(
        expect.stringContaining("materialization failed"),
        store.materializeError,
        expect.anything(),
      );
    });

    it("skipped invalid-amount deliveries are surfaced loudly via logError (never a silent $0)", async () => {
      const logError = vi.fn();
      store.materializeResult = {
        insertedPending: 0,
        insertedHeld: 0,
        skippedInvalidAmount: 2,
        releasedStuckHolds: 0,
      };
      await runTransferSweep({ store, stripe, now: NOW, logError });
      expect(logError).toHaveBeenCalledWith(
        expect.stringContaining("invalid derived amount"),
        expect.any(Error),
        expect.objectContaining({ metadata: { skippedInvalidAmount: 2 } }),
      );
    });
  });

  describe("eligibility negatives — each produces no transfer and leaves the entry pending", () => {
    it("before the 14-day hold elapses (FR-010)", async () => {
      store.seedTeacher("t1");
      store.seedEntry({ entryId: "e1", teacherId: "t1", amountCents: 5000, deliveredAt: new Date("2026-07-10T00:00:00Z") });
      const r = await runTransferSweep({ store, stripe, now: NOW });
      expect(stripe.create).not.toHaveBeenCalled();
      expect(store.entries.get("e1")!.status).toBe("pending");
      expect(r.claimed).toBe(0);
    });

    it("before the cutover date (FR-021)", async () => {
      store.seedTeacher("t1");
      store.seedEntry({ entryId: "e1", teacherId: "t1", amountCents: 5000, deliveredAt: new Date("2025-12-01T00:00:00Z") });
      await runTransferSweep({ store, stripe, now: NOW });
      expect(stripe.create).not.toHaveBeenCalled();
      expect(store.entries.get("e1")!.status).toBe("pending");
    });

    it("when payouts_enabled=false on the Stripe rail (FR-003)", async () => {
      store.seedTeacher("t1", { payoutsEnabled: false });
      store.seedEntry({ entryId: "e1", teacherId: "t1", amountCents: 5000 });
      await runTransferSweep({ store, stripe, now: NOW });
      expect(stripe.create).not.toHaveBeenCalled();
      expect(store.entries.get("e1")!.status).toBe("pending");
    });

    it("when an active payout_holds row exists (FR-023)", async () => {
      store.seedTeacher("t1");
      store.seedEntry({ entryId: "e1", teacherId: "t1", amountCents: 5000 });
      store.activeHolds.add("t1");
      await runTransferSweep({ store, stripe, now: NOW });
      expect(stripe.create).not.toHaveBeenCalled();
      expect(store.entries.get("e1")!.status).toBe("pending");
    });
  });

  describe("debt netting (FR-014)", () => {
    it("partial: transfers earning minus debt and records the recovery", async () => {
      store.seedTeacher("t1", { outstandingDebtCents: 2000 });
      store.seedEntry({ entryId: "e1", teacherId: "t1", amountCents: 5000 });

      const r = await runTransferSweep({ store, stripe, now: NOW });

      expect(stripe.create).toHaveBeenCalledTimes(1);
      expect(stripe.create.mock.calls[0][0].amount).toBe(3000); // 5000 - 2000
      expect(store.transfers[0].recoveredCents).toBe(2000);
      expect(store.entries.get("e1")!.status).toBe("transferred");
      expect(store.outstandingDebt("t1")).toBe(0);
      expect(r.transferred).toBe(1);
    });

    it("full consumption: zero Stripe calls, entry debt_recovered, remaining debt carried forward, recovers exactly once on replay", async () => {
      store.seedTeacher("t1", { outstandingDebtCents: 5000 });
      store.seedEntry({ entryId: "e1", teacherId: "t1", amountCents: 2000 });

      const r = await runTransferSweep({ store, stripe, now: NOW });

      expect(stripe.create).not.toHaveBeenCalled();
      expect(store.entries.get("e1")!.status).toBe("debt_recovered");
      expect(store.outstandingDebt("t1")).toBe(3000); // 5000 - 2000 carried forward
      expect(r.debtRecovered).toBe(1);

      // Replay: the debt_recovered entry is terminal → not re-claimed → recovered exactly once.
      await runTransferSweep({ store, stripe, now: NOW });
      expect(store.outstandingDebt("t1")).toBe(3000);
    });
  });

  describe("per-teacher running balance within a batch (no double-recovery)", () => {
    it("partial: two entries for one teacher net against a running balance — the debt is recovered once, not per-entry", async () => {
      store.seedTeacher("t1", { outstandingDebtCents: 2000 });
      store.seedEntry({ entryId: "e1", teacherId: "t1", amountCents: 3000 });
      store.seedEntry({ entryId: "e2", teacherId: "t1", amountCents: 3000 });

      const r = await runTransferSweep({ store, stripe, now: NOW });

      // e1 nets against 2000 (recover 2000, transfer 1000); e2 nets against the
      // now-zero running balance (recover 0, transfer 3000).
      expect(r.transferred).toBe(2);
      const amounts = stripe.create.mock.calls.map((c) => c[0].amount).sort((a, b) => a - b);
      expect(amounts).toEqual([1000, 3000]);
      expect(store.totalRecovered()).toBe(2000); // NOT 4000 — recovered once
      expect(store.outstandingDebt("t1")).toBe(0);
    });

    it("full consumption: two entries for one teacher each recover part of the running balance, both debt_recovered, zero Stripe", async () => {
      store.seedTeacher("t1", { outstandingDebtCents: 5000 });
      store.seedEntry({ entryId: "e1", teacherId: "t1", amountCents: 2000 });
      store.seedEntry({ entryId: "e2", teacherId: "t1", amountCents: 2000 });

      const r = await runTransferSweep({ store, stripe, now: NOW });

      expect(stripe.create).not.toHaveBeenCalled();
      expect(r.debtRecovered).toBe(2);
      expect(store.entries.get("e1")!.status).toBe("debt_recovered");
      expect(store.entries.get("e2")!.status).toBe("debt_recovered");
      // 5000 - 2000 - 2000 = 1000 carried forward (each recovered against the
      // running balance, never both against the original 5000).
      expect(store.outstandingDebt("t1")).toBe(1000);
    });
  });

  describe("manual rail (FR-026)", () => {
    it("routes to manual_due with zero Stripe calls", async () => {
      store.seedTeacher("t1", { payoutMethod: "manual", payoutsEnabled: false, destinationAccountId: null });
      store.seedEntry({ entryId: "e1", teacherId: "t1", amountCents: 5000 });

      const r = await runTransferSweep({ store, stripe, now: NOW });

      expect(stripe.create).not.toHaveBeenCalled();
      expect(store.entries.get("e1")!.status).toBe("manual_due");
      expect(r.manualDue).toBe(1);
    });

    it("applies debt netting before the manual settlement (full consumption → debt_recovered, still zero Stripe)", async () => {
      store.seedTeacher("t1", { payoutMethod: "manual", payoutsEnabled: false, destinationAccountId: null, outstandingDebtCents: 5000 });
      store.seedEntry({ entryId: "e1", teacherId: "t1", amountCents: 2000 });

      await runTransferSweep({ store, stripe, now: NOW });

      expect(stripe.create).not.toHaveBeenCalled();
      expect(store.entries.get("e1")!.status).toBe("debt_recovered");
      expect(store.outstandingDebt("t1")).toBe(3000);
    });
  });

  describe("failure path (FR-011)", () => {
    it("on a Stripe error the entry returns to pending, the error is recorded, the debt balance is restored, and a retry nets identically", async () => {
      store.seedTeacher("t1", { outstandingDebtCents: 2000 });
      store.seedEntry({ entryId: "e1", teacherId: "t1", amountCents: 5000 });
      const debtBefore = store.outstandingDebt("t1");

      stripe.create.mockRejectedValueOnce(new Error("stripe boom"));
      const logError = vi.fn();

      const r = await runTransferSweep({ store, stripe, now: NOW, logError });

      expect(r.failed).toBe(1);
      expect(r.transferred).toBe(0);
      expect(store.entries.get("e1")!.status).toBe("pending");
      expect(store.entries.get("e1")!.errorDetail).toContain("stripe boom");
      expect(logError).toHaveBeenCalled();
      // No recovery was written → the balance is exactly its pre-sweep value.
      expect(store.outstandingDebt("t1")).toBe(debtBefore);

      // Retry (Stripe now succeeds) nets identically against the restored debt.
      const retry = await runTransferSweep({ store, stripe, now: NOW });
      expect(retry.transferred).toBe(1);
      expect(stripe.create.mock.calls.at(-1)![0].amount).toBe(3000); // 5000 - 2000, same net
      expect(store.transfers.at(-1)!.recoveredCents).toBe(2000);
      expect(store.outstandingDebt("t1")).toBe(0);
    });

    it("fails closed on a non-USD entry without calling Stripe (FR-012)", async () => {
      store.seedTeacher("t1");
      store.seedEntry({ entryId: "e1", teacherId: "t1", amountCents: 5000, currency: "eur" });
      const logError = vi.fn();

      const r = await runTransferSweep({ store, stripe, now: NOW, logError });

      expect(stripe.create).not.toHaveBeenCalled();
      expect(r.failed).toBe(1);
      expect(store.entries.get("e1")!.status).toBe("pending");
      expect(logError).toHaveBeenCalled();
    });

    it("isolates a per-entry failure so other entries still settle, and counts each entry exactly once", async () => {
      store.seedTeacher("t1");
      store.seedTeacher("t2");
      store.seedEntry({ entryId: "e1", teacherId: "t1", amountCents: 5000 });
      store.seedEntry({ entryId: "e2", teacherId: "t2", amountCents: 4000 });
      // First create call rejects, second succeeds.
      stripe.create.mockRejectedValueOnce(new Error("boom"));

      const r = await runTransferSweep({ store, stripe, now: NOW });

      expect(r.failed).toBe(1);
      expect(r.transferred).toBe(1);
      // Exactly one outcome per entry — no double counting across branches.
      expect(r.failed + r.transferred + r.debtRecovered + r.manualDue + r.abandoned).toBe(r.claimed);
    });
  });

  describe("lease fencing (a stolen lease can never double-settle)", () => {
    it("if the entry is reclaimed mid-transfer (claimed_at changes), the original worker's fenced write is rejected — no transfer row, no recovery, no double count", async () => {
      store.seedTeacher("t1", { outstandingDebtCents: 2000 });
      store.seedEntry({ entryId: "e1", teacherId: "t1", amountCents: 5000 });
      const debtBefore = store.outstandingDebt("t1");

      // Simulate another sweep stealing the lease WHILE this worker is inside the
      // Stripe network call (between claim and the fenced settlement write).
      stripe.create.mockImplementationOnce(async (_p, o) => {
        store.entries.get("e1")!.claimedAt = new Date("2026-07-16T00:09:00Z"); // new owner's lease
        return { id: `tr_${o.idempotencyKey}` };
      });

      const r = await runTransferSweep({ store, stripe, now: NOW });

      // The Stripe transfer happened (idempotency key covers the new owner's
      // replay), but our fenced DB write hit 0 rows → abandoned.
      expect(stripe.create).toHaveBeenCalledTimes(1);
      expect(r.abandoned).toBe(1);
      expect(r.transferred).toBe(0);
      expect(r.failed).toBe(0);
      expect(store.transfers).toHaveLength(0); // no transfer row written by the loser
      expect(store.outstandingDebt("t1")).toBe(debtBefore); // no recovery written
      // Exactly one outcome per claimed entry.
      expect(r.failed + r.transferred + r.debtRecovered + r.manualDue + r.abandoned).toBe(r.claimed);
    });
  });

  describe("crash recovery (step 6)", () => {
    it("returns a processing entry whose lease has expired to pending, then re-settles it", async () => {
      store.seedTeacher("t1");
      // An orphaned lease: claimed 20 minutes ago, never settled (crash after claim).
      store.seedEntry({
        entryId: "e1",
        teacherId: "t1",
        amountCents: 5000,
        status: "processing",
        claimedAt: new Date("2026-07-15T23:40:00Z"),
      });

      const r = await runTransferSweep({ store, stripe, now: NOW, leaseTtlMs: 15 * 60 * 1000 });

      expect(r.reclaimed).toBe(1);
      // Reclaimed → pending → eligible → claimed and transferred in the same run.
      expect(stripe.create).toHaveBeenCalledTimes(1);
      expect(store.entries.get("e1")!.status).toBe("transferred");
    });

    it("does not reclaim a fresh lease still within its TTL", async () => {
      store.seedTeacher("t1");
      store.seedEntry({
        entryId: "e1",
        teacherId: "t1",
        amountCents: 5000,
        status: "processing",
        claimedAt: new Date("2026-07-15T23:55:00Z"), // 5 min ago
      });

      const r = await runTransferSweep({ store, stripe, now: NOW, leaseTtlMs: 15 * 60 * 1000 });

      expect(r.reclaimed).toBe(0);
      expect(stripe.create).not.toHaveBeenCalled();
      expect(store.entries.get("e1")!.status).toBe("processing");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Typed payout events (plan Phase 1 item 6) — best-effort, never load-bearing.
// ─────────────────────────────────────────────────────────────────────────
describe("runTransferSweep — emitPayoutEvent hook", () => {
  let store: FakeStore;
  let stripe: StripeTransfersApi & { create: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    store = new FakeStore();
    stripe = makeStripe();
  });

  it("emits payout.transfer_created with the NET amount after a successful settlement", async () => {
    store.seedTeacher("t1", { outstandingDebtCents: 1000 });
    store.seedEntry({ entryId: "e1", teacherId: "t1", amountCents: 5000 });
    const events: PayoutSweepEvent[] = [];

    await runTransferSweep({ store, stripe, now: NOW, emitPayoutEvent: (e) => void events.push(e) });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "payout.transfer_created",
      entryId: "e1",
      teacherId: "t1",
      transferCents: 4000, // 5000 earning − 1000 debt netted (FR-014)
      recoveredCents: 1000,
    });
  });

  it("emits payout.transfer_failed when the Stripe call fails (entry back to pending, FR-011)", async () => {
    store.seedTeacher("t1");
    store.seedEntry({ entryId: "e1", teacherId: "t1", amountCents: 5000 });
    stripe.create.mockRejectedValueOnce(new Error("insufficient platform balance"));
    const events: PayoutSweepEvent[] = [];

    const r = await runTransferSweep({
      store,
      stripe,
      now: NOW,
      emitPayoutEvent: (e) => void events.push(e),
    });

    expect(r.failed).toBe(1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "payout.transfer_failed",
      entryId: "e1",
      teacherId: "t1",
      errorDetail: "insufficient platform balance",
    });
  });

  it("emits nothing for manual-rail or debt-recovered settlements (no transfer happened)", async () => {
    store.seedTeacher("mt", { payoutMethod: "manual", payoutsEnabled: false, destinationAccountId: null });
    store.seedEntry({ entryId: "m1", teacherId: "mt", amountCents: 3000 });
    store.seedTeacher("dt", { outstandingDebtCents: 10000 });
    store.seedEntry({ entryId: "d1", teacherId: "dt", amountCents: 3000 });
    const events: PayoutSweepEvent[] = [];

    const r = await runTransferSweep({
      store,
      stripe,
      now: NOW,
      emitPayoutEvent: (e) => void events.push(e),
    });

    expect(r.manualDue).toBe(1);
    expect(r.debtRecovered).toBe(1);
    expect(events).toHaveLength(0);
  });

  it("emits nothing for an abandoned entry (the lease's new owner emits instead)", async () => {
    store.seedTeacher("t1");
    store.seedEntry({ entryId: "e1", teacherId: "t1", amountCents: 5000 });
    stripe.create.mockImplementationOnce(async (_p, o) => {
      store.entries.get("e1")!.claimedAt = new Date("2026-07-16T00:09:00Z"); // lease stolen
      return { id: `tr_${o.idempotencyKey}` };
    });
    const events: PayoutSweepEvent[] = [];

    const r = await runTransferSweep({
      store,
      stripe,
      now: NOW,
      emitPayoutEvent: (e) => void events.push(e),
    });

    expect(r.abandoned).toBe(1);
    expect(events).toHaveLength(0);
  });

  it("a manual-rail settlement error emits NO transfer_failed (no Stripe call was intended)", async () => {
    store.seedTeacher("mt", { payoutMethod: "manual", payoutsEnabled: false, destinationAccountId: null });
    store.seedEntry({ entryId: "m1", teacherId: "mt", amountCents: 3000 });
    store.recordManualDue = async () => {
      throw new Error("db hiccup");
    };
    const events: PayoutSweepEvent[] = [];
    const logError = vi.fn();

    const r = await runTransferSweep({
      store,
      stripe,
      now: NOW,
      logError,
      emitPayoutEvent: (e) => void events.push(e),
    });

    expect(r.failed).toBe(1); // fail-closed: entry back to pending
    expect(events).toHaveLength(0); // but no "your transfer failed" event
  });

  it("a throwing event sink never affects the settlement result (Principle III)", async () => {
    store.seedTeacher("t1");
    store.seedEntry({ entryId: "e1", teacherId: "t1", amountCents: 5000 });
    const logError = vi.fn();

    const r = await runTransferSweep({
      store,
      stripe,
      now: NOW,
      logError,
      emitPayoutEvent: () => {
        throw new Error("analytics down");
      },
    });

    expect(r.transferred).toBe(1);
    expect(store.entries.get("e1")!.status).toBe("transferred");
    expect(logError).toHaveBeenCalledWith(
      "transfer-sweep: payout event emit failed (best-effort)",
      expect.any(Error),
      expect.objectContaining({ tag: "connect" }),
    );
  });
});
