import { describe, it, expect, vi } from "vitest";

import {
  settleManualPayout,
  ManualSettlementError,
  type ManualSettlementStore,
} from "./manual-settlement";

// Spec 040 Phase 1 (item 5) — the manual-rail settlement decision, closing the
// loop the #716 sweep opens: the sweep flips a manual-rail entry
// processing → manual_due (connect_sweep_record_manual_due); this settles it
// manual_due → manual_paid off-Stripe with an external reference (FR-027).
//
// This module owns the INPUT contract and orchestration only: validate (zod),
// trim, delegate to the store's single conditional RPC. Atomicity, the
// `status='manual_due' AND payout_method='manual'` guard, and replay-no-op live
// in the SQL (connect_settle_manual_due) — proven by the rolled-back walk. The
// store is injected so this is testable with no DB (mirrors transfer-sweep).

const ENTRY = "11111111-1111-4111-8111-111111111111";
const ADMIN = "22222222-2222-4222-a222-222222222222";

function fakeStore(result: boolean): ManualSettlementStore & {
  settleManualDue: ReturnType<typeof vi.fn>;
} {
  return { settleManualDue: vi.fn().mockResolvedValue(result) };
}

function base() {
  return { entryId: ENTRY, referenceId: "BANK-TXN-42", settlingAdmin: ADMIN };
}

describe("settleManualPayout", () => {
  describe("happy path", () => {
    it("settles a manual_due entry and reports settled: true", async () => {
      const store = fakeStore(true);
      const result = await settleManualPayout(store, base());
      expect(result).toEqual({ settled: true });
      expect(store.settleManualDue).toHaveBeenCalledWith({
        entryId: ENTRY,
        referenceId: "BANK-TXN-42",
        settlingAdmin: ADMIN,
      });
    });

    it("trims the reference before it reaches the store (never store whitespace)", async () => {
      const store = fakeStore(true);
      await settleManualPayout(store, { ...base(), referenceId: "  BANK-TXN-42  " });
      expect(store.settleManualDue).toHaveBeenCalledWith(
        expect.objectContaining({ referenceId: "BANK-TXN-42" }),
      );
    });
  });

  describe("no-op / refusal (store returns false)", () => {
    // The SQL returns false when the fenced UPDATE hit zero rows: a replay
    // (already manual_paid), a wrong-status entry, or a stripe_connect entry the
    // `payout_method='manual'` guard refused. The orchestration surfaces that
    // faithfully as settled: false — never an exception, never a silent success.
    it("reports settled: false when the store's conditional update hit nothing", async () => {
      const store = fakeStore(false);
      const result = await settleManualPayout(store, base());
      expect(result).toEqual({ settled: false });
    });
  });

  describe("fail-closed input guards (money path)", () => {
    it.each(["", "   ", "\t\n"])(
      "throws on a blank reference (%j) and never calls the store",
      async (blank) => {
        const store = fakeStore(true);
        await expect(
          settleManualPayout(store, { ...base(), referenceId: blank }),
        ).rejects.toBeInstanceOf(ManualSettlementError);
        expect(store.settleManualDue).not.toHaveBeenCalled();
      },
    );

    it("throws when the entry id is not a uuid, and never calls the store", async () => {
      const store = fakeStore(true);
      await expect(
        settleManualPayout(store, { ...base(), entryId: "not-a-uuid" }),
      ).rejects.toBeInstanceOf(ManualSettlementError);
      expect(store.settleManualDue).not.toHaveBeenCalled();
    });

    it("throws when the settling admin id is not a uuid, and never calls the store", async () => {
      const store = fakeStore(true);
      await expect(
        settleManualPayout(store, { ...base(), settlingAdmin: "nope" }),
      ).rejects.toBeInstanceOf(ManualSettlementError);
      expect(store.settleManualDue).not.toHaveBeenCalled();
    });
  });
});
