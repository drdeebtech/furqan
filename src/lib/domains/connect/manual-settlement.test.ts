import { describe, it, expect, vi } from "vitest";

import {
  settleManualPayout,
  ManualSettlementError,
  type ManualSettlementOutcome,
  type ManualSettlementStore,
} from "./manual-settlement";

// Spec 040 Phase 1 (item 5) + FR-027a — the manual-rail settlement decision.
// The sweep flips a manual-rail entry processing → manual_due; this closes it
// at its NET value (settle-time debt netting, expected-net optimistic fence).
//
// This module owns the INPUT contract and orchestration only: validate (zod),
// trim, delegate to the store's single conditional RPC and surface its typed
// outcome verbatim. Atomicity, the rail/status guard, the FIFO netting, the
// stale-net fence and the hold refusal live in the SQL
// (connect_settle_manual_due, migration 20260811) — proven by the rolled-back
// walks. The store is injected so this is testable with no DB.

const ENTRY = "11111111-1111-4111-8111-111111111111";
const ADMIN = "22222222-2222-4222-a222-222222222222";

function fakeStore(result: ManualSettlementOutcome): ManualSettlementStore & {
  settleManualDue: ReturnType<typeof vi.fn>;
} {
  return { settleManualDue: vi.fn().mockResolvedValue(result) };
}

const SETTLED: ManualSettlementOutcome = {
  outcome: "settled",
  netPaidCents: 700,
  recoveredCents: 300,
};

function base() {
  return {
    entryId: ENTRY,
    referenceId: "BANK-TXN-42",
    settlingAdmin: ADMIN,
    expectedNetCents: 700,
  };
}

describe("settleManualPayout", () => {
  describe("happy path", () => {
    it("settles a manual_due entry at its expected net and surfaces the outcome", async () => {
      const store = fakeStore(SETTLED);
      const result = await settleManualPayout(store, base());
      expect(result).toEqual(SETTLED);
      expect(store.settleManualDue).toHaveBeenCalledWith({
        entryId: ENTRY,
        referenceId: "BANK-TXN-42",
        settlingAdmin: ADMIN,
        expectedNetCents: 700,
      });
    });

    it("trims the reference before it reaches the store (never store whitespace)", async () => {
      const store = fakeStore(SETTLED);
      await settleManualPayout(store, { ...base(), referenceId: "  BANK-TXN-42  " });
      expect(store.settleManualDue).toHaveBeenCalledWith(
        expect.objectContaining({ referenceId: "BANK-TXN-42" }),
      );
    });

    it("allows a missing reference for the zero-net close (nothing is paid)", async () => {
      const store = fakeStore({ outcome: "closed_debt_recovered", recoveredCents: 1000 });
      const result = await settleManualPayout(store, {
        entryId: ENTRY,
        settlingAdmin: ADMIN,
        expectedNetCents: 0,
      });
      expect(result).toEqual({ outcome: "closed_debt_recovered", recoveredCents: 1000 });
    });
  });

  describe("typed refusals surfaced verbatim (never collapsed to a boolean)", () => {
    it.each<ManualSettlementOutcome>([
      { outcome: "not_found" },
      { outcome: "teacher_on_hold" },
      { outcome: "stale_net", netDueCents: 450 },
    ])("surfaces %j faithfully", async (refusal) => {
      const store = fakeStore(refusal);
      const result = await settleManualPayout(store, base());
      expect(result).toEqual(refusal);
    });
  });

  describe("fail-closed input guards (money path)", () => {
    it.each(["", "   ", "\t\n"])(
      "throws on a blank reference (%j) when money moves, and never calls the store",
      async (blank) => {
        const store = fakeStore(SETTLED);
        await expect(
          settleManualPayout(store, { ...base(), referenceId: blank }),
        ).rejects.toBeInstanceOf(ManualSettlementError);
        expect(store.settleManualDue).not.toHaveBeenCalled();
      },
    );

    it("throws when the reference is absent but expectedNetCents > 0", async () => {
      const store = fakeStore(SETTLED);
      await expect(
        settleManualPayout(store, { entryId: ENTRY, settlingAdmin: ADMIN, expectedNetCents: 700 }),
      ).rejects.toBeInstanceOf(ManualSettlementError);
      expect(store.settleManualDue).not.toHaveBeenCalled();
    });

    it.each([-1, 0.5, Number.NaN])(
      "throws on a non-integer or negative expected net (%j), and never calls the store",
      async (bad) => {
        const store = fakeStore(SETTLED);
        await expect(
          settleManualPayout(store, { ...base(), expectedNetCents: bad }),
        ).rejects.toBeInstanceOf(ManualSettlementError);
        expect(store.settleManualDue).not.toHaveBeenCalled();
      },
    );

    it("throws when the entry id is not a uuid, and never calls the store", async () => {
      const store = fakeStore(SETTLED);
      await expect(
        settleManualPayout(store, { ...base(), entryId: "not-a-uuid" }),
      ).rejects.toBeInstanceOf(ManualSettlementError);
      expect(store.settleManualDue).not.toHaveBeenCalled();
    });

    it("throws when the settling admin id is not a uuid, and never calls the store", async () => {
      const store = fakeStore(SETTLED);
      await expect(
        settleManualPayout(store, { ...base(), settlingAdmin: "nope" }),
      ).rejects.toBeInstanceOf(ManualSettlementError);
      expect(store.settleManualDue).not.toHaveBeenCalled();
    });
  });
});
