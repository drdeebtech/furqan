import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PREPAID_DEFAULT_RATE_USD,
  PREPAID_DEFAULT_CUSTOM_MIN,
  PREPAID_DEFAULT_CUSTOM_MAX,
} from "./prepaid-defaults";

/**
 * These fallbacks are used when platform_settings cannot be read — and two of
 * the three consumers are CHARGE paths (amountCents = hours × rate × 100).
 * A fallback that drifts from the seeded rate silently bills the wrong amount:
 * exactly what happened when 20260817000000 raised the seed to $14 while three
 * hardcoded copies still said 10.
 *
 * The migration is the source of truth, so assert against the migration file
 * itself rather than restating the number — a future rate change that forgets
 * this constant fails here instead of in production billing.
 */
const REPO_ROOT = join(__dirname, "..", "..", "..", "..");

function readMigration(name: string): string {
  return readFileSync(join(REPO_ROOT, "supabase", "migrations", name), "utf8");
}

describe("prepaid-hours defaults", () => {
  it("matches the rate actually seeded by the price-ladder migration", () => {
    const sql = readMigration("20260817000000_hifz_price_ladder.sql");

    // The migration's UPDATE ... set value = '<rate>' for prepaid_hours_rate_usd.
    const match = sql.match(/set value = '(\d+(?:\.\d+)?)'\s*\n\s*where key = 'prepaid_hours_rate_usd'/);

    expect(match, "could not find the prepaid rate UPDATE in the migration").not.toBeNull();
    expect(Number(match![1])).toBe(PREPAID_DEFAULT_RATE_USD);
  });

  it("is not the pre-ladder $10 rate", () => {
    // Guards the specific regression: the old value silently undercharged 29%.
    expect(PREPAID_DEFAULT_RATE_USD).not.toBe(10);
  });

  it("keeps custom-hour bounds sane", () => {
    expect(PREPAID_DEFAULT_CUSTOM_MIN).toBeGreaterThanOrEqual(1);
    expect(PREPAID_DEFAULT_CUSTOM_MAX).toBeGreaterThan(PREPAID_DEFAULT_CUSTOM_MIN);
  });

  it("is the single definition — no consumer keeps its own copy of the defaults", () => {
    // The two checkout routes no longer import prepaid-defaults directly —
    // they go through resolvePrepaidQuote (see the next test). Only that
    // module and the anon-safe pricing page read the raw constants.
    const consumers = [
      "src/app/(public)/pricing/page.tsx",
      "src/lib/domains/billing/prepaid-quote.ts",
    ];

    for (const rel of consumers) {
      const src = readFileSync(join(REPO_ROOT, rel), "utf8");
      expect(src, `${rel} redeclares the rate locally`).not.toMatch(
        /^const DEFAULT_RATE_USD\s*=/m,
      );
      expect(src, `${rel} does not import the shared default`).toContain(
        "prepaid-defaults",
      );
    }
  });

  it("both prepaid checkout routes resolve the quote through resolvePrepaidQuote, not their own copy", () => {
    const routes = [
      "src/app/api/stripe/checkout/prepaid-hours/route.ts",
      "src/app/api/paypal/checkout/prepaid-hours/route.ts",
    ];

    for (const rel of routes) {
      const src = readFileSync(join(REPO_ROOT, rel), "utf8");
      expect(src, `${rel} still defines its own readRateUsd`).not.toMatch(
        /function readRateUsd/,
      );
      expect(src, `${rel} still defines its own readCustomBounds`).not.toMatch(
        /function readCustomBounds/,
      );
      expect(src, `${rel} does not import resolvePrepaidQuote`).toContain(
        "resolvePrepaidQuote",
      );
    }
  });
});
