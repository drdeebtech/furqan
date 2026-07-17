import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

vi.mock("server-only", () => ({}));
import {
  handleChargeDisputeClosed,
  handleConnectAccountUpdated,
  handleConnectPayoutEvent,
  handleConnectTransferEvent,
} from "./connect-webhook-handlers";
import type { EventContext } from "./webhook-handlers";
import type {
  ApplyStatusOutcome,
  ConnectAccountsStore,
} from "@/lib/domains/connect/connect-accounts";

vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));
import { logError } from "@/lib/logger";

const clawbackCalls: string[] = [];
vi.mock("@/lib/domains/connect/clawback", () => ({
  applyChargeClawbacks: vi.fn(async () => {
    clawbackCalls.push("claw");
    return { entriesTouched: 1, reversedCents: 0, clawbackCents: 100 };
  }),
  releaseDisputedEntries: vi.fn(async () => {
    clawbackCalls.push("release");
    return 1;
  }),
  disputeChargeId: (d: { charge?: unknown }) =>
    typeof d.charge === "string" ? d.charge : null,
}));
import { applyChargeClawbacks, releaseDisputedEntries } from "@/lib/domains/connect/clawback";

// Minimal EventContext stub: markEvent needs .from().update().eq(); the
// transfer handler needs .rpc(). Both recorded for assertions.
function makeCtx(event: { type: string; account?: string; data: { object: unknown } }) {
  const marked: string[] = [];
  const rpcCalls: Array<{ name: string; args: unknown }> = [];
  let rpcResult: { data: unknown; error: unknown } = { data: "reconciled", error: null };
  const admin = {
    from: () => ({
      update: (payload: { status: string }) => ({
        eq: async () => {
          marked.push(payload.status);
          return { error: null };
        },
      }),
    }),
    rpc: vi.fn(async (name: string, args?: unknown) => {
      rpcCalls.push({ name, args });
      return rpcResult;
    }),
  };
  const retrieve = vi.fn();
  const ctx = {
    admin: admin as never,
    stripe: { accounts: { retrieve } } as never,
    event: {
      id: "evt_1",
      created: 1_768_000_000,
      account: "acct_evt",
      ...event,
    } as unknown as Stripe.Event,
    billingEventId: "be_1",
  } satisfies EventContext;
  return {
    ctx,
    marked,
    rpcCalls,
    retrieve,
    setRpcResult: (r: { data: unknown; error: unknown }) => {
      rpcResult = r;
    },
  };
}

function makeStore(outcomes: ApplyStatusOutcome[]) {
  const applied: Array<{ stripeAccountId: string; payoutsEnabled: boolean; eventAt: Date }> = [];
  const store: ConnectAccountsStore = {
    getByTeacherId: async () => null,
    linkAccount: async () => undefined,
    applyAccountStatus: async (input) => {
      applied.push({
        stripeAccountId: input.stripeAccountId,
        payoutsEnabled: input.payoutsEnabled,
        eventAt: input.eventAt,
      });
      return outcomes.shift() ?? "applied";
    },
  };
  return { store, applied };
}

function accountObject(overrides: Record<string, unknown> = {}) {
  return {
    id: "acct_1",
    charges_enabled: true,
    payouts_enabled: true,
    details_submitted: true,
    requirements: { currently_due: [], past_due: [], disabled_reason: null },
    metadata: {},
    ...overrides,
  };
}

describe("handleConnectAccountUpdated (FR-003)", () => {
  it("applies a fresh snapshot with the event timestamp and marks processed", async () => {
    const { ctx, marked } = makeCtx({ type: "account.updated", data: { object: accountObject() } });
    const { store, applied } = makeStore(["applied"]);

    await handleConnectAccountUpdated(ctx, store);

    expect(applied).toHaveLength(1);
    expect(applied[0].stripeAccountId).toBe("acct_1");
    expect(applied[0].eventAt).toEqual(new Date(1_768_000_000 * 1000));
    expect(marked).toEqual(["processed"]);
  });

  it("on 'stale' fetches the AUTHORITATIVE state and re-applies with now() (tie-break)", async () => {
    const { ctx, marked, retrieve } = makeCtx({
      type: "account.updated",
      data: { object: accountObject({ payouts_enabled: false }) },
    });
    retrieve.mockResolvedValueOnce(accountObject({ payouts_enabled: true }));
    const { store, applied } = makeStore(["stale", "applied"]);

    await handleConnectAccountUpdated(ctx, store);

    expect(retrieve).toHaveBeenCalledWith("acct_1");
    expect(applied).toHaveLength(2);
    // The re-apply carries the authoritative flags, stamped with a fresh clock
    // strictly after the stored event time.
    expect(applied[1].payoutsEnabled).toBe(true);
    expect(applied[1].eventAt.getTime()).toBeGreaterThan(applied[0].eventAt.getTime());
    expect(marked).toEqual(["processed"]);
  });

  it("throws for unknown_account carrying OUR metadata (Stripe must redeliver)", async () => {
    const { ctx, marked } = makeCtx({
      type: "account.updated",
      data: { object: accountObject({ metadata: { furqan_teacher_id: "t-1" } }) },
    });
    const { store } = makeStore(["unknown_account"]);

    await expect(handleConnectAccountUpdated(ctx, store)).rejects.toThrow(/before link committed/);
    expect(marked).toEqual([]); // dispatch's catch marks failed — not this handler
  });

  it("ignores unknown_account without our metadata (foreign account)", async () => {
    const { ctx, marked } = makeCtx({
      type: "account.updated",
      data: { object: accountObject() },
    });
    const { store } = makeStore(["unknown_account"]);

    await handleConnectAccountUpdated(ctx, store);

    expect(marked).toEqual(["ignored"]);
  });
});

describe("handleConnectTransferEvent", () => {
  it("reconciles transfer.created via the RPC and marks processed", async () => {
    const { ctx, marked, rpcCalls } = makeCtx({
      type: "transfer.created",
      data: { object: { id: "tr_1" } },
    });

    await handleConnectTransferEvent(ctx);

    expect(rpcCalls[0]).toEqual({
      name: "connect_reconcile_transfer",
      args: { p_stripe_transfer_id: "tr_1", p_reversed: false },
    });
    expect(marked).toEqual(["processed"]);
  });

  it("passes p_reversed=true for transfer.reversed", async () => {
    const { ctx, rpcCalls } = makeCtx({
      type: "transfer.reversed",
      data: { object: { id: "tr_2" } },
    });

    await handleConnectTransferEvent(ctx);

    expect(rpcCalls[0]?.args).toEqual({ p_stripe_transfer_id: "tr_2", p_reversed: true });
  });

  it("an unknown transfer logs an ops signal but still processes (no retry storm)", async () => {
    const { ctx, marked, setRpcResult } = makeCtx({
      type: "transfer.created",
      data: { object: { id: "tr_ghost" } },
    });
    setRpcResult({ data: "unknown_transfer", error: null });

    await handleConnectTransferEvent(ctx);

    expect(logError).toHaveBeenCalledWith(
      "connect-webhook: transfer event for unknown teacher_transfers row",
      null,
      expect.objectContaining({ tag: "connect-webhook" }),
    );
    expect(marked).toEqual(["processed"]);
  });

  it("an rpc transport error THROWS (Stripe retries; never silently dropped)", async () => {
    const { ctx, setRpcResult } = makeCtx({
      type: "transfer.created",
      data: { object: { id: "tr_3" } },
    });
    setRpcResult({ data: null, error: { message: "connection reset" } });

    await expect(handleConnectTransferEvent(ctx)).rejects.toThrow(/reconcile rpc failed/);
  });
});

describe("handleConnectPayoutEvent", () => {
  it("payout.failed raises the ops alert and processes", async () => {
    const { ctx, marked } = makeCtx({
      type: "payout.failed",
      data: { object: { id: "po_1", failure_code: "account_closed", failure_message: "closed" } },
    });

    await handleConnectPayoutEvent(ctx);

    expect(logError).toHaveBeenCalledWith(
      "connect-webhook: teacher bank payout FAILED",
      expect.any(Error),
      expect.objectContaining({
        tag: "connect-webhook",
        metadata: expect.objectContaining({ payoutId: "po_1", failureCode: "account_closed" }),
      }),
    );
    expect(marked).toEqual(["processed"]);
  });

  it("payout.paid is informational — processed, no alert", async () => {
    vi.mocked(logError).mockClear();
    const { ctx, marked } = makeCtx({ type: "payout.paid", data: { object: { id: "po_2" } } });

    await handleConnectPayoutEvent(ctx);

    expect(logError).not.toHaveBeenCalled();
    expect(marked).toEqual(["processed"]);
  });
});


describe("handleChargeDisputeClosed (spec 040 FR-015)", () => {
  it("won: releases this dispute's holds and processes", async () => {
    clawbackCalls.length = 0;
    const { ctx, marked } = makeCtx({
      type: "charge.dispute.closed",
      data: { object: { id: "dp_1", currency: "usd", charge: "ch_1", status: "won", amount: 10_000 } },
    });

    await handleChargeDisputeClosed(ctx);

    expect(releaseDisputedEntries).toHaveBeenCalledWith(ctx, "dp_1");
    expect(applyChargeClawbacks).not.toHaveBeenCalled();
    expect(marked).toEqual(["processed"]);
  });

  it("warning_closed (inquiry ended without a dispute) releases like a win", async () => {
    clawbackCalls.length = 0;
    vi.mocked(releaseDisputedEntries).mockClear();
    const { ctx, marked } = makeCtx({
      type: "charge.dispute.closed",
      data: { object: { id: "dp_2", currency: "usd", charge: "ch_1", status: "warning_closed", amount: 10_000 } },
    });

    await handleChargeDisputeClosed(ctx);

    expect(releaseDisputedEntries).toHaveBeenCalledWith(ctx, "dp_2");
    expect(marked).toEqual(["processed"]);
  });

  it("lost: claws back BEFORE releasing (no sweep window), using the charge total", async () => {
    clawbackCalls.length = 0;
    vi.mocked(applyChargeClawbacks).mockClear();
    const { ctx, marked } = makeCtx({
      type: "charge.dispute.closed",
      data: { object: { id: "dp_3", currency: "usd", charge: "ch_1", status: "lost", amount: 7_500 } },
    });
    const chargesRetrieve = vi.fn(async () => ({ id: "ch_1", amount: 10_000 }));
    (ctx.stripe as unknown as { charges: { retrieve: typeof chargesRetrieve } }).charges = {
      retrieve: chargesRetrieve,
    };

    await handleChargeDisputeClosed(ctx);

    expect(chargesRetrieve).toHaveBeenCalledWith("ch_1");
    expect(applyChargeClawbacks).toHaveBeenCalledWith(ctx, {
      chargeId: "ch_1",
      sourceReferenceId: "dp_3",
      reclaimedCents: 7_500,
      chargeAmountCents: 10_000,
      source: "dispute",
    });
    // Order is load-bearing: claw while held, release the residue after.
    expect(clawbackCalls).toEqual(["claw", "release"]);
    expect(marked).toEqual(["processed"]);
  });

  it("unexpected status keeps the holds (fail-safe) and surfaces to ops", async () => {
    clawbackCalls.length = 0;
    vi.mocked(applyChargeClawbacks).mockClear();
    vi.mocked(releaseDisputedEntries).mockClear();
    const { ctx, marked } = makeCtx({
      type: "charge.dispute.closed",
      data: { object: { id: "dp_4", currency: "usd", charge: "ch_1", status: "needs_response", amount: 10_000 } },
    });

    await handleChargeDisputeClosed(ctx);

    expect(applyChargeClawbacks).not.toHaveBeenCalled();
    expect(releaseDisputedEntries).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining("unexpected status"),
      null,
      expect.objectContaining({ dispute_id: "dp_4" }),
    );
    expect(marked).toEqual(["processed"]);
  });

  it("non-USD dispute closures are ignored before any release/clawback (FR-012)", async () => {
    vi.mocked(releaseDisputedEntries).mockClear();
    vi.mocked(applyChargeClawbacks).mockClear();
    const { ctx, marked } = makeCtx({
      type: "charge.dispute.closed",
      data: { object: { id: "dp_9", currency: "eur", charge: "ch_1", status: "lost", amount: 10_000 } },
    });

    await handleChargeDisputeClosed(ctx);

    expect(releaseDisputedEntries).not.toHaveBeenCalled();
    expect(applyChargeClawbacks).not.toHaveBeenCalled();
    expect(marked).toEqual(["ignored"]);
  });

  it("missing charge id is ignored", async () => {
    const { ctx, marked } = makeCtx({
      type: "charge.dispute.closed",
      data: { object: { id: "dp_5", currency: "usd", status: "won", amount: 10_000 } },
    });

    await handleChargeDisputeClosed(ctx);

    expect(marked).toEqual(["ignored"]);
  });
});
