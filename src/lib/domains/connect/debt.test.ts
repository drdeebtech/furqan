import { describe, it, expect } from "vitest";

import {
  computeOutstandingDebtCents,
  netEarningAgainstDebt,
  type DebtLedgerRow,
} from "./debt";

// FR-014 (signed-ledger). ONE formula, mirroring the migration header exactly:
//   outstanding_debt_cents =
//     GREATEST(0, -1 * SUM(amount_cents) WHERE kind IN
//       ('clawback','debt_recovery','debt_recovery_reversal'))
// Earning rows (session/course) are NOT part of the sum — they are what PAYS
// the debt, not the debt itself. Debt can never read negative (floored at 0).

const row = (kind: DebtLedgerRow["kind"], amountCents: number): DebtLedgerRow => ({
  kind,
  amountCents,
});

describe("computeOutstandingDebtCents", () => {
  it("empty ledger → 0", () => {
    expect(computeOutstandingDebtCents([])).toBe(0);
  });

  it("the walk case: -600 clawback + 400 recovery - 400 reversal → 600", () => {
    expect(
      computeOutstandingDebtCents([
        row("clawback", -600),
        row("debt_recovery", 400),
        row("debt_recovery_reversal", -400),
      ]),
    ).toBe(600);
  });

  it("a single clawback of -600 → 600 of debt", () => {
    expect(computeOutstandingDebtCents([row("clawback", -600)])).toBe(600);
  });

  it("clawback fully recovered (-600 + 600) → 0", () => {
    expect(
      computeOutstandingDebtCents([row("clawback", -600), row("debt_recovery", 600)]),
    ).toBe(600 * 0);
  });

  it("EXCLUDES earning rows — a session earning does not reduce debt", () => {
    // +100000 of earnings must not net against a -600 clawback here: netting is
    // a separate, explicit step (netEarningAgainstDebt), not an implicit sum.
    expect(
      computeOutstandingDebtCents([
        row("session", 100000),
        row("course", 50000),
        row("clawback", -600),
      ]),
    ).toBe(600);
  });

  it("floors at 0 — over-recovery never produces a negative (i.e. a credit) debt", () => {
    // -400 clawback but +900 of recovery rows (a data anomaly) must read 0, not -500.
    expect(
      computeOutstandingDebtCents([
        row("clawback", -400),
        row("debt_recovery", 900),
      ]),
    ).toBe(0);
  });

  it("multiple clawbacks accumulate", () => {
    expect(
      computeOutstandingDebtCents([
        row("clawback", -600),
        row("clawback", -250),
        row("debt_recovery", 100),
      ]),
    ).toBe(750);
  });

  it("reversal restores debt a recovery had paid down", () => {
    // -600 clawback, +600 recovery (debt 0), then the recovery is reversed (-600) → 600 again.
    expect(
      computeOutstandingDebtCents([
        row("clawback", -600),
        row("debt_recovery", 600),
        row("debt_recovery_reversal", -600),
      ]),
    ).toBe(600);
  });
});

// FR-014 netting. Before EVERY transfer the sweep nets the teacher's outstanding
// debt against the claimed earning, in integer cents, inside the atomic claim:
//   transfer_cents = max(0, earning_cents - outstanding_debt_cents)
// The consumed amount reduces the debt and is recorded as its own append-only
// debt_recovery row so replay never double-recovers. If transfer_cents == 0 the
// earning is fully consumed and the entry closes as `debt_recovered` (terminal,
// non-paying) with any remaining debt carried forward. This function returns a
// PLAN (what rows to write); it never writes.
describe("netEarningAgainstDebt", () => {
  it("no debt → full transfer, no recovery, entry transfers", () => {
    expect(netEarningAgainstDebt({ earningCents: 1000, outstandingDebtCents: 0 })).toEqual({
      transferCents: 1000,
      recoveredCents: 0,
      remainingDebtCents: 0,
      closesAsDebtRecovered: false,
    });
  });

  it("partial debt → reduced transfer, recovery for the offset, debt cleared", () => {
    expect(netEarningAgainstDebt({ earningCents: 1000, outstandingDebtCents: 400 })).toEqual({
      transferCents: 600,
      recoveredCents: 400,
      remainingDebtCents: 0,
      closesAsDebtRecovered: false,
    });
  });

  it("debt equals earning → zero transfer, fully consumed, closes debt_recovered", () => {
    expect(netEarningAgainstDebt({ earningCents: 1000, outstandingDebtCents: 1000 })).toEqual({
      transferCents: 0,
      recoveredCents: 1000,
      remainingDebtCents: 0,
      closesAsDebtRecovered: true,
    });
  });

  it("debt exceeds earning → zero transfer, earning fully consumed, remainder carried forward", () => {
    expect(netEarningAgainstDebt({ earningCents: 1000, outstandingDebtCents: 1500 })).toEqual({
      transferCents: 0,
      recoveredCents: 1000,
      remainingDebtCents: 500,
      closesAsDebtRecovered: true,
    });
  });

  it("identity: transfer + recovered always equals the earning (no cent lost or invented)", () => {
    for (const [earning, debt] of [
      [1000, 0],
      [1000, 400],
      [1000, 1000],
      [1000, 1500],
      [777, 333],
      [1, 1],
    ] as const) {
      const p = netEarningAgainstDebt({ earningCents: earning, outstandingDebtCents: debt });
      expect(p.transferCents + p.recoveredCents).toBe(earning);
    }
  });

  it("a zero earning with no debt → zero transfer, does NOT close as debt_recovered", () => {
    // A sub-cent-rounded earning (deriveEarningCents can return 0) with no debt is
    // not a debt recovery — nothing was consumed.
    expect(netEarningAgainstDebt({ earningCents: 0, outstandingDebtCents: 0 })).toEqual({
      transferCents: 0,
      recoveredCents: 0,
      remainingDebtCents: 0,
      closesAsDebtRecovered: false,
    });
  });

  it("rejects a negative earning (earnings are positive by the sign convention)", () => {
    expect(() =>
      netEarningAgainstDebt({ earningCents: -100, outstandingDebtCents: 0 }),
    ).toThrow();
  });

  it("rejects a negative debt (outstanding debt is floored at 0 upstream)", () => {
    expect(() =>
      netEarningAgainstDebt({ earningCents: 1000, outstandingDebtCents: -1 }),
    ).toThrow();
  });

  it("rejects non-integer inputs (integer cents only)", () => {
    expect(() =>
      netEarningAgainstDebt({ earningCents: 100.5, outstandingDebtCents: 0 }),
    ).toThrow();
  });
});
