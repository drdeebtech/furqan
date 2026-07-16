import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  runTransferSweep,
  type ClaimedEntry,
  type SweepStore,
  type StripeTransfersApi,
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
// per-entry money decisions (debt netting, manual rail, failure) are correct.
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

      entry.status = "processing";
      entry.claimedAt = now;
      claimed.push({
        entryId: entry.entryId,
        teacherId: entry.teacherId,
        amountCents: entry.amountCents,
        outstandingDebtCents: t.outstandingDebtCents,
        payoutMethod: t.payoutMethod,
        destinationAccountId: t.destinationAccountId,
        transferGroup: entry.transferGroup,
        currency: entry.currency,
      });
    }
    return claimed;
  }

  async recordDebtRecovered(input: { entryId: string; teacherId: string; recoveredCents: number }): Promise<void> {
    const entry = this.entries.get(input.entryId)!;
    entry.status = "debt_recovered";
    const t = this.teachers.get(input.teacherId)!;
    t.outstandingDebtCents -= input.recoveredCents;
  }

  async recordManualDue(input: { entryId: string; teacherId: string; recoveredCents: number }): Promise<void> {
    const entry = this.entries.get(input.entryId)!;
    entry.status = "manual_due";
    const t = this.teachers.get(input.teacherId)!;
    t.outstandingDebtCents -= input.recoveredCents;
  }

  async recordTransferSucceeded(input: {
    entryId: string;
    teacherId: string;
    stripeTransferId: string;
    amountCents: number;
    recoveredCents: number;
    transferGroup: string | null;
    idempotencyKey: string;
  }): Promise<void> {
    const entry = this.entries.get(input.entryId)!;
    entry.status = "transferred";
    const t = this.teachers.get(input.teacherId)!;
    t.outstandingDebtCents -= input.recoveredCents;
    this.transfers.push({
      entryId: input.entryId,
      teacherId: input.teacherId,
      stripeTransferId: input.stripeTransferId,
      amountCents: input.amountCents,
      recoveredCents: input.recoveredCents,
      idempotencyKey: input.idempotencyKey,
    });
  }

  async recordTransferFailed(input: { entryId: string; errorDetail: string }): Promise<void> {
    const entry = this.entries.get(input.entryId)!;
    entry.status = "pending";
    entry.claimedAt = null;
    entry.errorDetail = input.errorDetail;
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

    it("isolates a per-entry failure so other entries still settle", async () => {
      store.seedTeacher("t1");
      store.seedTeacher("t2");
      store.seedEntry({ entryId: "e1", teacherId: "t1", amountCents: 5000 });
      store.seedEntry({ entryId: "e2", teacherId: "t2", amountCents: 4000 });
      // First create call rejects, second succeeds.
      stripe.create.mockRejectedValueOnce(new Error("boom"));

      const r = await runTransferSweep({ store, stripe, now: NOW });

      expect(r.failed).toBe(1);
      expect(r.transferred).toBe(1);
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
