import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ConnectSweepStore } from "./transfer-sweep-store";

// Stub the service-role admin client down to the ONE method callRpc uses:
// `.rpc(name, args)` (callRpc binds `this` and returns the awaited result).
// Each test asserts the adapter maps a SweepStore method to the right RPC name,
// shapes the args object, and reshapes the row — the SQL itself is proven in
// scripts/walk-040-sweep-functions.sql, not here.
function makeAdmin(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn(async (_name: string, _args?: unknown) => result);
  // ConnectSweepStore only ever touches `.rpc`; cast through unknown.
  return { admin: { rpc } as never, rpc };
}

const LEASE = new Date("2026-07-16T00:00:00.000Z");

describe("ConnectSweepStore — RPC mapping", () => {
  it("reclaimExpiredLeases → connect_sweep_reclaim_expired_leases, returns the count", async () => {
    const { admin, rpc } = makeAdmin({ data: 3, error: null });
    const store = new ConnectSweepStore(admin);

    const n = await store.reclaimExpiredLeases(LEASE);

    expect(n).toBe(3);
    expect(rpc).toHaveBeenCalledWith("connect_sweep_reclaim_expired_leases", {
      p_lease_cutoff: "2026-07-16T00:00:00.000Z",
    });
  });

  it("materializeSessionEarnings → connect_materialize_session_earnings, maps the counts row", async () => {
    const { admin, rpc } = makeAdmin({
      data: [
        { inserted_pending: 2, inserted_held: 1, skipped_invalid_amount: 4, released_stuck_holds: 1 },
      ],
      error: null,
    });
    const store = new ConnectSweepStore(admin);

    const counts = await store.materializeSessionEarnings();

    expect(rpc).toHaveBeenCalledWith("connect_materialize_session_earnings", {});
    expect(counts).toEqual({
      insertedPending: 2,
      insertedHeld: 1,
      skippedInvalidAmount: 4,
      releasedStuckHolds: 1,
    });
  });

  it("materializeSessionEarnings coerces a missing row to zeros and THROWS on rpc error", async () => {
    const empty = new ConnectSweepStore(makeAdmin({ data: [], error: null }).admin);
    expect(await empty.materializeSessionEarnings()).toEqual({
      insertedPending: 0,
      insertedHeld: 0,
      skippedInvalidAmount: 0,
      releasedStuckHolds: 0,
    });

    const failing = new ConnectSweepStore(
      makeAdmin({ data: null, error: { message: "boom", code: "XX000" } }).admin,
    );
    await expect(failing.materializeSessionEarnings()).rejects.toThrow(
      /materializeSessionEarnings: rpc failed/,
    );
  });

  it("reclaimExpiredLeases coerces a null count to 0", async () => {
    const { admin } = makeAdmin({ data: null, error: null });
    const store = new ConnectSweepStore(admin);
    expect(await store.reclaimExpiredLeases(LEASE)).toBe(0);
  });

  it("claimEligibleEntries → connect_sweep_claim_eligible, reshapes each row to ClaimedEntry", async () => {
    const row = {
      entry_id: "e1",
      teacher_id: "t1",
      amount_cents: 5000,
      kind: "session",
      payout_method: "stripe_connect",
      destination_account_id: "acct_1",
      transfer_group: "tg_1",
      currency: "usd",
      claimed_at: "2026-07-16T00:00:00.000Z",
      outstanding_debt_cents: 1200,
    };
    const { admin, rpc } = makeAdmin({ data: [row], error: null });
    const store = new ConnectSweepStore(admin);

    const claimed = await store.claimEligibleEntries(LEASE);

    expect(rpc).toHaveBeenCalledWith("connect_sweep_claim_eligible", {
      p_now: "2026-07-16T00:00:00.000Z",
    });
    expect(claimed).toEqual([
      {
        entryId: "e1",
        teacherId: "t1",
        amountCents: 5000,
        outstandingDebtCents: 1200,
        payoutMethod: "stripe_connect",
        destinationAccountId: "acct_1",
        transferGroup: "tg_1",
        currency: "usd",
        claimedAt: new Date("2026-07-16T00:00:00.000Z"),
      },
    ]);
  });

  it("claimEligibleEntries coerces null data to an empty array", async () => {
    const { admin } = makeAdmin({ data: null, error: null });
    const store = new ConnectSweepStore(admin);
    expect(await store.claimEligibleEntries(LEASE)).toEqual([]);
  });

  it("recordTransferSucceeded → connect_sweep_record_transfer_succeeded with the full arg set", async () => {
    const { admin, rpc } = makeAdmin({ data: true, error: null });
    const store = new ConnectSweepStore(admin);

    const ok = await store.recordTransferSucceeded({
      entryId: "e1",
      teacherId: "t1",
      stripeTransferId: "tr_1",
      amountCents: 3800,
      recoveredCents: 1200,
      transferGroup: "tg_1",
      idempotencyKey: "transfer:e1",
      claimedAt: LEASE,
    });

    expect(ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("connect_sweep_record_transfer_succeeded", {
      p_entry_id: "e1",
      p_teacher_id: "t1",
      p_stripe_transfer_id: "tr_1",
      p_amount_cents: 3800,
      p_recovered_cents: 1200,
      p_transfer_group: "tg_1",
      p_idempotency_key: "transfer:e1",
      p_claimed_at: "2026-07-16T00:00:00.000Z",
    });
  });

  it("a false fence result maps straight through (lease lost → abandon)", async () => {
    const { admin } = makeAdmin({ data: false, error: null });
    const store = new ConnectSweepStore(admin);
    expect(
      await store.recordTransferSucceeded({
        entryId: "e1",
        teacherId: "t1",
        stripeTransferId: "tr_1",
        amountCents: 3800,
        recoveredCents: 0,
        transferGroup: null,
        idempotencyKey: "transfer:e1",
        claimedAt: LEASE,
      }),
    ).toBe(false);
  });

  it("recordTransferFailed → connect_sweep_record_transfer_failed and drops errorDetail (logged upstream, not persisted)", async () => {
    const { admin, rpc } = makeAdmin({ data: true, error: null });
    const store = new ConnectSweepStore(admin);

    const ok = await store.recordTransferFailed({
      entryId: "e1",
      errorDetail: "stripe: card_declined",
      claimedAt: LEASE,
    });

    expect(ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("connect_sweep_record_transfer_failed", {
      p_entry_id: "e1",
      p_claimed_at: "2026-07-16T00:00:00.000Z",
    });
    // errorDetail must NOT be forwarded to the RPC.
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty("p_error_detail");
  });

  it("recordDebtRecovered → connect_sweep_record_debt_recovered", async () => {
    const { admin, rpc } = makeAdmin({ data: true, error: null });
    const store = new ConnectSweepStore(admin);

    await store.recordDebtRecovered({
      entryId: "e1",
      teacherId: "t1",
      recoveredCents: 5000,
      claimedAt: LEASE,
    });

    expect(rpc).toHaveBeenCalledWith("connect_sweep_record_debt_recovered", {
      p_entry_id: "e1",
      p_teacher_id: "t1",
      p_recovered_cents: 5000,
      p_claimed_at: "2026-07-16T00:00:00.000Z",
    });
  });

  it("recordManualDue → connect_sweep_record_manual_due", async () => {
    const { admin, rpc } = makeAdmin({ data: true, error: null });
    const store = new ConnectSweepStore(admin);

    await store.recordManualDue({
      entryId: "e1",
      teacherId: "t1",
      recoveredCents: 0,
      claimedAt: LEASE,
    });

    expect(rpc).toHaveBeenCalledWith("connect_sweep_record_manual_due", {
      p_entry_id: "e1",
      p_teacher_id: "t1",
      p_recovered_cents: 0,
      p_claimed_at: "2026-07-16T00:00:00.000Z",
    });
  });

  it("an rpc error THROWS (transient DB error is not a lost lease → orchestrator fails closed)", async () => {
    const { admin } = makeAdmin({ data: null, error: { message: "connection reset", code: "57P01" } });
    const store = new ConnectSweepStore(admin);

    await expect(
      store.recordTransferSucceeded({
        entryId: "e1",
        teacherId: "t1",
        stripeTransferId: "tr_1",
        amountCents: 3800,
        recoveredCents: 0,
        transferGroup: null,
        idempotencyKey: "transfer:e1",
        claimedAt: LEASE,
      }),
    ).rejects.toThrow(/rpc failed/);
  });
});
