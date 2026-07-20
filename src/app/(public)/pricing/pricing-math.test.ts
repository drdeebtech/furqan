import { describe, it, expect } from "vitest";
import { perUnitCents, savingPct } from "./content";

/**
 * The 2026-07-20 price ladder only sells if the per-unit price is VISIBLE.
 * These assert the arithmetic the redesign puts on every card, using the real
 * live prices — so if a future price change flattens the ladder again, the
 * "declining" assertion fails here rather than shipping a card that claims a
 * saving nobody gets.
 */
const plan = (code: string, priceCents: number, credits: number) => ({
  id: code,
  plan_code: code,
  name: code,
  monthly_credit_count: credits,
  price_cents: priceCents,
});

const GROUP = [
  plan("hifz_group_4", 1200, 4),
  plan("hifz_group_6", 1500, 6),
  plan("hifz_group_8", 1800, 8),
];

const INDIVIDUAL = [
  plan("hifz_individual_4h", 4400, 4),
  plan("hifz_individual_6h", 6000, 6),
  plan("hifz_individual_8h", 7200, 8),
];

describe("perUnitCents", () => {
  it("computes the live per-session price for group tiers", () => {
    expect(GROUP.map(perUnitCents)).toEqual([300, 250, 225]);
  });

  it("computes the live per-hour price for individual tiers", () => {
    expect(INDIVIDUAL.map(perUnitCents)).toEqual([1100, 1000, 900]);
  });

  it("never divides by zero on a malformed plan", () => {
    expect(perUnitCents(plan("broken", 5000, 0))).toBe(5000);
  });
});

describe("the ladder actually declines", () => {
  const tracks: ReadonlyArray<readonly [string, typeof GROUP]> = [
    ["group", GROUP],
    ["individual", INDIVIDUAL],
  ];

  for (const [name, tiers] of tracks) {
    it(`${name} per-unit price falls at every step`, () => {
      const units = tiers.map(perUnitCents);
      for (let i = 1; i < units.length; i++) {
        expect(units[i]).toBeLessThan(units[i - 1]);
      }
    });
  }
});

describe("savingPct", () => {
  const entryGroup = Math.max(...GROUP.map(perUnitCents));
  const entryIndividual = Math.max(...INDIVIDUAL.map(perUnitCents));

  it("shows no saving on the entry tier itself", () => {
    expect(savingPct(GROUP[0], entryGroup)).toBe(0);
    expect(savingPct(INDIVIDUAL[0], entryIndividual)).toBe(0);
  });

  it("reports the real saving against the smallest plan", () => {
    // group: 250 vs 300 = 17%; 225 vs 300 = 25%
    expect(savingPct(GROUP[1], entryGroup)).toBe(17);
    expect(savingPct(GROUP[2], entryGroup)).toBe(25);
    // individual: 1000 vs 1100 = 9%; 900 vs 1100 = 18%
    expect(savingPct(INDIVIDUAL[1], entryIndividual)).toBe(9);
    expect(savingPct(INDIVIDUAL[2], entryIndividual)).toBe(18);
  });

  it("never claims a saving that does not exist", () => {
    for (const tiers of [GROUP, INDIVIDUAL]) {
      const entry = Math.max(...tiers.map(perUnitCents));
      for (const p of tiers) {
        const pct = savingPct(p, entry);
        expect(pct).toBeGreaterThanOrEqual(0);
        expect(pct).toBeLessThan(100);
      }
    }
  });

  it("degrades safely when the baseline is unusable", () => {
    expect(savingPct(GROUP[0], 0)).toBe(0);
  });
});
