import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventContext } from "@/lib/domains/billing/webhook-handlers";

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: vi.fn((fn: () => unknown) => fn()) }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));
vi.mock("@/lib/automation/emit", () => ({ emitEvent: vi.fn(async () => undefined) }));
vi.mock("@/lib/mixpanel-server", () => ({
  MIXPANEL_EVENTS: { PAYOUT_CLAWBACK: "payout_clawback" },
  trackMixpanel: vi.fn(async () => undefined),
}));

const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
const rpcResults = new Map<string, { data: unknown; error: { message: string } | null }>();
vi.mock("@/lib/supabase/rpc", () => ({
  callRpc: vi.fn(async (_client: unknown, name: string, args: Record<string, unknown>) => {
    rpcCalls.push({ name, args });
    return rpcResults.get(name) ?? { data: null, error: null };
  }),
}));

import { emitEvent } from "@/lib/automation/emit";
import {
  applyChargeClawbacks,
  holdDisputedEntries,
  releaseDisputedEntries,
} from "./clawback";

interface EntryRowSeed {
  entry_id: string;
  teacher_id?: string;
  status?: string;
  amount_cents: number;
  remaining_cap_cents: number;
  stripe_transfer_id?: string | null;
  source_already_applied?: boolean;
}

function seedList(rows: EntryRowSeed[]) {
  rpcResults.set("connect_clawback_list_entries", {
    data: rows.map((r) => ({
      teacher_id: "t-1",
      status: "pending",
      stripe_transfer_id: null,
      source_already_applied: false,
      ...r,
    })),
    error: null,
  });
}

function seedReservation(res: {
  outcome: string;
  reversed_cents: number;
  shortfall_cents: number;
  already_confirmed: boolean;
}) {
  rpcResults.set("connect_clawback_reserve_reversal", { data: [res], error: null });
}

function makeCtx() {
  const retrieve = vi.fn();
  const createReversal = vi.fn();
  const ctx = {
    admin: {} as never,
    stripe: { transfers: { retrieve, createReversal } } as never,
    event: { id: "evt_1", type: "charge.refunded" } as never,
    billingEventId: "be_1",
  } satisfies EventContext;
  return { ctx, retrieve, createReversal };
}

const BASE_INPUT = {
  chargeId: "ch_1",
  sourceReferenceId: "re_1",
  reclaimedCents: 2_500,
  chargeAmountCents: 10_000,
  source: "refund" as const,
};

beforeEach(() => {
  rpcCalls.length = 0;
  rpcResults.clear();
  rpcResults.set("connect_clawback_apply", { data: "clawback_recorded", error: null });
  rpcResults.set("connect_clawback_confirm_reversal", { data: "confirmed", error: null });
  vi.mocked(emitEvent).mockClear();
});

describe("applyChargeClawbacks — unsettled entries (FR-013 → FR-014 netting)", () => {
  it("writes a floor-proportional clawback for a partial refund", async () => {
    const { ctx } = makeCtx();
    // teacher share 5000 of a 10000 charge; 2500 refunded → floor(5000*2500/10000)=1250
    seedList([{ entry_id: "e1", amount_cents: 5_000, remaining_cap_cents: 5_000 }]);

    const result = await applyChargeClawbacks(ctx, BASE_INPUT);

    const apply = rpcCalls.find((c) => c.name === "connect_clawback_apply");
    expect(apply?.args).toEqual({
      p_entry_id: "e1",
      p_source_reference_id: "re_1",
      p_clawback_cents: 1_250,
    });
    expect(result).toEqual({ entriesTouched: 1, reversedCents: 0, clawbackCents: 1_250 });
  });

  it("caps the clawback at the entry's remaining reclaimable amount", async () => {
    const { ctx } = makeCtx();
    seedList([{ entry_id: "e1", amount_cents: 5_000, remaining_cap_cents: 800 }]);

    await applyChargeClawbacks(ctx, BASE_INPUT);

    const apply = rpcCalls.find((c) => c.name === "connect_clawback_apply");
    expect(apply?.args.p_clawback_cents).toBe(800);
  });

  it("skips an unsettled entry this source already clawed (cumulative-refund-list replay)", async () => {
    const { ctx } = makeCtx();
    seedList([
      {
        entry_id: "e1",
        amount_cents: 5_000,
        remaining_cap_cents: 3_750,
        source_already_applied: true,
      },
    ]);

    const result = await applyChargeClawbacks(ctx, BASE_INPUT);

    expect(rpcCalls.map((c) => c.name)).toEqual(["connect_clawback_list_entries"]);
    expect(result.entriesTouched).toBe(0);
  });

  it("skips entries with an exhausted cap and zero-cent proportional shares", async () => {
    const { ctx } = makeCtx();
    seedList([
      { entry_id: "e1", amount_cents: 5_000, remaining_cap_cents: 0 },
      // floor(3 * 2500 / 10000) = 0 → nothing to write
      { entry_id: "e2", amount_cents: 3, remaining_cap_cents: 3 },
    ]);

    const result = await applyChargeClawbacks(ctx, BASE_INPUT);

    expect(rpcCalls.map((c) => c.name)).toEqual(["connect_clawback_list_entries"]);
    expect(result.entriesTouched).toBe(0);
  });
});

describe("applyChargeClawbacks — settled entries (reserve → Stripe → confirm)", () => {
  it("reserves BEFORE Stripe, reverses the reserved amount, then confirms", async () => {
    const { ctx, retrieve, createReversal } = makeCtx();
    retrieve.mockResolvedValueOnce({ amount: 5_000, amount_reversed: 0 });
    createReversal.mockResolvedValueOnce({ id: "trr_1" });
    seedList([
      { entry_id: "e1", amount_cents: 5_000, remaining_cap_cents: 5_000, stripe_transfer_id: "tr_1" },
    ]);
    seedReservation({ outcome: "reserved", reversed_cents: 1_250, shortfall_cents: 0, already_confirmed: false });

    const result = await applyChargeClawbacks(ctx, BASE_INPUT);

    const names = rpcCalls.map((c) => c.name);
    // reserve strictly precedes the Stripe call's confirm
    expect(names).toEqual([
      "connect_clawback_list_entries",
      "connect_clawback_reserve_reversal",
      "connect_clawback_confirm_reversal",
    ]);
    const reserve = rpcCalls[1];
    expect(reserve.args).toEqual({
      p_entry_id: "e1",
      p_source_reference_id: "re_1",
      p_stripe_transfer_id: "tr_1",
      p_reversed_cents: 1_250,
      p_shortfall_cents: 0,
    });
    expect(createReversal).toHaveBeenCalledWith(
      "tr_1",
      expect.objectContaining({ amount: 1_250 }),
      { idempotencyKey: "reversal:re_1:tr_1" },
    );
    expect(rpcCalls[2].args).toEqual({
      p_idempotency_key: "reversal:re_1:tr_1",
      p_stripe_reversal_id: "trr_1",
    });
    expect(result).toEqual({ entriesTouched: 1, reversedCents: 1_250, clawbackCents: 0 });
  });

  it("plans a reversal + shortfall split when Stripe's reversible balance is short", async () => {
    const { ctx, retrieve, createReversal } = makeCtx();
    retrieve.mockResolvedValueOnce({ amount: 5_000, amount_reversed: 4_200 }); // reversible 800
    createReversal.mockResolvedValueOnce({ id: "trr_2" });
    seedList([
      { entry_id: "e1", amount_cents: 5_000, remaining_cap_cents: 5_000, stripe_transfer_id: "tr_1" },
    ]);
    seedReservation({ outcome: "reserved", reversed_cents: 800, shortfall_cents: 450, already_confirmed: false });

    const result = await applyChargeClawbacks(ctx, BASE_INPUT); // C = 1250 → 800 + 450

    expect(rpcCalls[1].args.p_reversed_cents).toBe(800);
    expect(rpcCalls[1].args.p_shortfall_cents).toBe(450);
    expect(createReversal).toHaveBeenCalledWith(
      "tr_1",
      expect.objectContaining({ amount: 800 }),
      expect.anything(),
    );
    expect(result).toEqual({ entriesTouched: 1, reversedCents: 800, clawbackCents: 450 });
  });

  it("pure-debt reservation (nothing reversible) makes no Stripe write", async () => {
    const { ctx, retrieve, createReversal } = makeCtx();
    retrieve.mockResolvedValueOnce({ amount: 5_000, amount_reversed: 5_000 });
    seedList([
      { entry_id: "e1", amount_cents: 5_000, remaining_cap_cents: 5_000, stripe_transfer_id: "tr_1" },
    ]);
    seedReservation({ outcome: "reserved", reversed_cents: 0, shortfall_cents: 1_250, already_confirmed: false });

    const result = await applyChargeClawbacks(ctx, BASE_INPUT);

    expect(createReversal).not.toHaveBeenCalled();
    expect(rpcCalls.map((c) => c.name)).not.toContain("connect_clawback_confirm_reversal");
    expect(result).toEqual({ entriesTouched: 1, reversedCents: 0, clawbackCents: 1_250 });
  });

  it("resumes a crashed reservation without re-planning (source_already_applied)", async () => {
    const { ctx, retrieve, createReversal } = makeCtx();
    createReversal.mockResolvedValueOnce({ id: "trr_3" });
    seedList([
      {
        entry_id: "e1",
        amount_cents: 5_000,
        remaining_cap_cents: 3_750, // reservation already counted against the cap
        stripe_transfer_id: "tr_1",
        source_already_applied: true,
      },
    ]);
    seedReservation({ outcome: "already_reserved", reversed_cents: 1_250, shortfall_cents: 0, already_confirmed: false });

    const result = await applyChargeClawbacks(ctx, BASE_INPUT);

    expect(retrieve).not.toHaveBeenCalled(); // no re-planning — DB amounts are authoritative
    expect(rpcCalls[1].args.p_reversed_cents).toBe(0); // plan inputs unused on resume
    expect(createReversal).toHaveBeenCalledWith(
      "tr_1",
      expect.objectContaining({ amount: 1_250 }),
      { idempotencyKey: "reversal:re_1:tr_1" },
    );
    expect(result.reversedCents).toBe(1_250);
  });

  it("a fully-confirmed reservation is a pure replay: no Stripe, no emission", async () => {
    const { ctx, retrieve, createReversal } = makeCtx();
    seedList([
      {
        entry_id: "e1",
        amount_cents: 5_000,
        remaining_cap_cents: 3_750,
        stripe_transfer_id: "tr_1",
        source_already_applied: true,
      },
    ]);
    seedReservation({ outcome: "already_reserved", reversed_cents: 1_250, shortfall_cents: 0, already_confirmed: true });

    const result = await applyChargeClawbacks(ctx, BASE_INPUT);

    expect(retrieve).not.toHaveBeenCalled();
    expect(createReversal).not.toHaveBeenCalled();
    expect(emitEvent).not.toHaveBeenCalled();
    expect(result.entriesTouched).toBe(0);
  });

  it("throws when confirm fails AFTER a live reversal (event must retry)", async () => {
    const { ctx, retrieve, createReversal } = makeCtx();
    retrieve.mockResolvedValueOnce({ amount: 5_000, amount_reversed: 0 });
    createReversal.mockResolvedValueOnce({ id: "trr_4" });
    seedList([
      { entry_id: "e1", amount_cents: 5_000, remaining_cap_cents: 5_000, stripe_transfer_id: "tr_1" },
    ]);
    seedReservation({ outcome: "reserved", reversed_cents: 1_250, shortfall_cents: 0, already_confirmed: false });
    rpcResults.set("connect_clawback_confirm_reversal", {
      data: null,
      error: { message: "connection reset" },
    });

    await expect(applyChargeClawbacks(ctx, BASE_INPUT)).rejects.toThrow(/confirm failed/);
  });
});

describe("applyChargeClawbacks — guards and emission", () => {
  it("no-ops on zero reclaimed and on an unlinked charge", async () => {
    const { ctx } = makeCtx();
    seedList([]);

    const zero = await applyChargeClawbacks(ctx, { ...BASE_INPUT, reclaimedCents: 0 });
    expect(zero.entriesTouched).toBe(0);
    expect(rpcCalls).toHaveLength(0); // guard fires before the list RPC

    const unlinked = await applyChargeClawbacks(ctx, BASE_INPUT);
    expect(unlinked.entriesTouched).toBe(0);
  });

  it("throws when the list RPC fails", async () => {
    const { ctx } = makeCtx();
    rpcResults.set("connect_clawback_list_entries", {
      data: null,
      error: { message: "boom" },
    });

    await expect(applyChargeClawbacks(ctx, BASE_INPUT)).rejects.toThrow(/list entries failed/);
  });

  it("emits payout.clawback per touched entry (best-effort)", async () => {
    const { ctx } = makeCtx();
    seedList([{ entry_id: "e1", amount_cents: 5_000, remaining_cap_cents: 5_000 }]);

    await applyChargeClawbacks(ctx, BASE_INPUT);

    expect(emitEvent).toHaveBeenCalledWith(
      "payout.clawback",
      "earning_entry",
      "e1",
      expect.objectContaining({ teacher_id: "t-1", debt_cents: 1_250, source: "refund" }),
    );
  });
});

describe("dispute hold / release (FR-015)", () => {
  it("holdDisputedEntries passes charge + dispute ids and returns the count", async () => {
    const { ctx } = makeCtx();
    rpcResults.set("connect_dispute_hold", { data: 3, error: null });

    const held = await holdDisputedEntries(ctx, "ch_1", "dp_1");

    expect(rpcCalls[0]).toEqual({
      name: "connect_dispute_hold",
      args: { p_funding_charge_id: "ch_1", p_dispute_id: "dp_1" },
    });
    expect(held).toBe(3);
  });

  it("releaseDisputedEntries passes the dispute id; both throw on RPC failure", async () => {
    const { ctx } = makeCtx();
    rpcResults.set("connect_dispute_release", { data: 2, error: null });
    expect(await releaseDisputedEntries(ctx, "dp_1")).toBe(2);

    rpcResults.set("connect_dispute_release", { data: null, error: { message: "down" } });
    await expect(releaseDisputedEntries(ctx, "dp_1")).rejects.toThrow(/release failed/);
    rpcResults.set("connect_dispute_hold", { data: null, error: { message: "down" } });
    await expect(holdDisputedEntries(ctx, "ch_1", "dp_1")).rejects.toThrow(/hold failed/);
  });
});
