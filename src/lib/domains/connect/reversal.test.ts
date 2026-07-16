import { describe, it, expect } from "vitest";

import { computeProportionalReversalCents } from "./reversal";

// FR-013 + scenarios 1-3. On charge.refunded, reverse the teacher's share
// PROPORTIONALLY to the refunded fraction, in integer cents, with the platform
// absorbing the sub-cent remainder — the INVERSE of revenue-split.ts (never claw
// back more than the teacher received). The reversal is capped at what is still
// reversible on the transfer; any shortfall becomes negative-balance debt (which
// FR-014 netting later offsets). Pure: no Stripe, no DB.
//
//   raw_clawback   = floor(teacher_share * refunded_amount / charge_amount)
//   reversal       = min(raw_clawback, reversible_balance)
//   shortfall_debt = raw_clawback - reversal

describe("computeProportionalReversalCents", () => {
  describe("full refund (scenario 1)", () => {
    it("full refund, fully reversible → reverse the whole teacher share, no debt", () => {
      expect(
        computeProportionalReversalCents({
          teacherShareCents: 1000,
          refundedAmountCents: 4900,
          chargeAmountCents: 4900,
          reversibleBalanceCents: 1000,
        }),
      ).toEqual({ reversalCents: 1000, shortfallDebtCents: 0 });
    });
  });

  describe("partial refund, proportional (scenario 2)", () => {
    it("50% refund → half the teacher share", () => {
      expect(
        computeProportionalReversalCents({
          teacherShareCents: 1000,
          refundedAmountCents: 2450,
          chargeAmountCents: 4900,
          reversibleBalanceCents: 1000,
        }),
      ).toEqual({ reversalCents: 500, shortfallDebtCents: 0 });
    });

    it("sub-cent remainder is absorbed by the platform (round DOWN — never claw back more than received)", () => {
      // 1000 * 1633 / 4900 = 333.26... → 333. The .26¢ stays with the teacher.
      expect(
        computeProportionalReversalCents({
          teacherShareCents: 1000,
          refundedAmountCents: 1633,
          chargeAmountCents: 4900,
          reversibleBalanceCents: 1000,
        }),
      ).toEqual({ reversalCents: 333, shortfallDebtCents: 0 });
    });

    it("zero refund → no reversal, no debt", () => {
      expect(
        computeProportionalReversalCents({
          teacherShareCents: 1000,
          refundedAmountCents: 0,
          chargeAmountCents: 4900,
          reversibleBalanceCents: 1000,
        }),
      ).toEqual({ reversalCents: 0, shortfallDebtCents: 0 });
    });
  });

  describe("reversible balance smaller than clawback owed (scenario 3)", () => {
    it("caps the reversal at the reversible balance, records the shortfall as debt", () => {
      // Full refund owes 1000 back, but only 600 is still reversible (400 already
      // paid out) → reverse 600, the 400 shortfall becomes negative-balance debt.
      expect(
        computeProportionalReversalCents({
          teacherShareCents: 1000,
          refundedAmountCents: 4900,
          chargeAmountCents: 4900,
          reversibleBalanceCents: 600,
        }),
      ).toEqual({ reversalCents: 600, shortfallDebtCents: 400 });
    });

    it("nothing reversible (teacher fully paid out) → entire clawback becomes debt", () => {
      expect(
        computeProportionalReversalCents({
          teacherShareCents: 1000,
          refundedAmountCents: 4900,
          chargeAmountCents: 4900,
          reversibleBalanceCents: 0,
        }),
      ).toEqual({ reversalCents: 0, shortfallDebtCents: 1000 });
    });
  });

  describe("conservation property", () => {
    it("reversal + shortfall always equals the proportional clawback, and reversal never exceeds what the teacher received", () => {
      const cases = [
        { teacherShareCents: 1000, refundedAmountCents: 4900, chargeAmountCents: 4900, reversibleBalanceCents: 600 },
        { teacherShareCents: 733, refundedAmountCents: 1200, chargeAmountCents: 3600, reversibleBalanceCents: 100 },
        { teacherShareCents: 2500, refundedAmountCents: 2500, chargeAmountCents: 10000, reversibleBalanceCents: 5000 },
        { teacherShareCents: 1, refundedAmountCents: 1, chargeAmountCents: 2, reversibleBalanceCents: 1 },
      ] as const;
      for (const c of cases) {
        const { reversalCents, shortfallDebtCents } = computeProportionalReversalCents(c);
        const rawClawback = Math.floor(
          (c.teacherShareCents * c.refundedAmountCents) / c.chargeAmountCents,
        );
        expect(reversalCents + shortfallDebtCents).toBe(rawClawback);
        expect(reversalCents).toBeLessThanOrEqual(c.reversibleBalanceCents);
        expect(reversalCents).toBeLessThanOrEqual(c.teacherShareCents);
        expect(reversalCents).toBeGreaterThanOrEqual(0);
        expect(shortfallDebtCents).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe("fail-closed validation", () => {
    it("throws on a zero charge amount (no proportion is definable)", () => {
      expect(() =>
        computeProportionalReversalCents({
          teacherShareCents: 1000,
          refundedAmountCents: 0,
          chargeAmountCents: 0,
          reversibleBalanceCents: 1000,
        }),
      ).toThrow();
    });

    it("throws when the refund exceeds the charge (impossible input)", () => {
      expect(() =>
        computeProportionalReversalCents({
          teacherShareCents: 1000,
          refundedAmountCents: 5000,
          chargeAmountCents: 4900,
          reversibleBalanceCents: 1000,
        }),
      ).toThrow();
    });

    it("throws on negative inputs", () => {
      expect(() =>
        computeProportionalReversalCents({
          teacherShareCents: -1,
          refundedAmountCents: 100,
          chargeAmountCents: 4900,
          reversibleBalanceCents: 1000,
        }),
      ).toThrow();
    });

    it("throws on non-integer inputs (integer cents only)", () => {
      expect(() =>
        computeProportionalReversalCents({
          teacherShareCents: 1000.5,
          refundedAmountCents: 100,
          chargeAmountCents: 4900,
          reversibleBalanceCents: 1000,
        }),
      ).toThrow();
    });
  });
});
