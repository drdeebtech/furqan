import { describe, it, expect } from "vitest";
import {
  TRIAL_POLICY,
  ABSENCE_POLICY,
  PAY_CADENCE,
  SESSION_DURATION,
  PRICING_MODEL,
  FAMILY_POLICY,
  PREPAID_HOURS_POLICY,
} from "./policies";

/**
 * Guards the anti-contradiction invariant (decision 45): the short and long
 * variants of each policy must encode the SAME facts, and the facts must
 * match the ratified decisions — so a future copy edit that flips a policy
 * on one surface fails here instead of shipping a live contradiction again.
 */
describe("policy copy — single source of truth invariants", () => {
  it("trial is FREE in every variant and both languages (decision 40)", () => {
    expect(TRIAL_POLICY.short.ar).toContain("مجانية");
    expect(TRIAL_POLICY.long.ar).toContain("مجانية");
    expect(TRIAL_POLICY.short.en.toLowerCase()).toContain("free");
    expect(TRIAL_POLICY.long.en.toLowerCase()).toContain("free");
    // Never the old paid-trial wording.
    expect(TRIAL_POLICY.long.ar).not.toContain("مدفوعة");
    expect(TRIAL_POLICY.long.en.toLowerCase()).not.toContain("paid");
  });

  it("trial duration is 30 minutes everywhere it is stated", () => {
    expect(TRIAL_POLICY.short.ar).toContain("٣٠");
    expect(TRIAL_POLICY.long.ar).toContain("٣٠");
    expect(TRIAL_POLICY.short.en).toContain("30");
    expect(TRIAL_POLICY.long.en).toContain("30");
    expect(SESSION_DURATION.evaluation.ar).toContain("٣٠");
    expect(SESSION_DURATION.evaluation.en).toContain("30");
  });

  it("trial long copy carries the WhatsApp confirmation instrument (decision 40)", () => {
    expect(TRIAL_POLICY.long.ar).toContain("واتساب");
    expect(TRIAL_POLICY.long.en).toContain("WhatsApp");
  });

  it("absence policy states the 2-hour excused/rescheduled rule, not blanket forfeiture (decision 7)", () => {
    expect(ABSENCE_POLICY.long.ar).toContain("ساعتين");
    expect(ABSENCE_POLICY.long.en).toContain("2 hours");
    for (const v of [ABSENCE_POLICY.short, ABSENCE_POLICY.long]) {
      expect(v.ar).toMatch(/جدولة|تُعاد/);
      expect(v.en.toLowerCase()).toContain("reschedul");
    }
    // Never the old "regardless" wording.
    expect(ABSENCE_POLICY.long.ar).not.toContain("بغض النظر");
  });

  it("payout cadence is monthly, never weekly (decision 18)", () => {
    expect(PAY_CADENCE.ar).toContain("شهرية");
    expect(PAY_CADENCE.en.toLowerCase()).toContain("monthly");
    expect(PAY_CADENCE.ar).not.toContain("أسبوعية");
    expect(PAY_CADENCE.en.toLowerCase()).not.toContain("weekly");
  });

  it("group session duration is 60 minutes (decision 10)", () => {
    expect(SESSION_DURATION.group.ar).toContain("٦٠");
    expect(SESSION_DURATION.group.en).toContain("60");
  });

  it("family policy never states a discount percentage — the seeded % is a placeholder (A6)", () => {
    for (const v of [FAMILY_POLICY.short, FAMILY_POLICY.long]) {
      // No % sign, no Western or Arabic-Indic digits anywhere: the number is
      // admin-configurable and NOT owner-approved for public copy.
      expect(v.ar).not.toMatch(/[%٪0-9٠-٩]/);
      expect(v.en).not.toMatch(/[%0-9]/);
    }
    expect(FAMILY_POLICY.long.ar).toContain("خصم واحد");
    expect(FAMILY_POLICY.long.en.toLowerCase()).toContain("one discount per subscription");
  });

  it("pricing disambiguator names both systems in both languages (decision 42)", () => {
    for (const v of [PRICING_MODEL.disambiguator, PRICING_MODEL.teacherRateCaption]) {
      expect(v.ar.length).toBeGreaterThan(10);
      expect(v.en.length).toBeGreaterThan(10);
    }
    expect(PRICING_MODEL.disambiguator.ar).toContain("اشتراكات");
    expect(PRICING_MODEL.disambiguator.en.toLowerCase()).toContain("subscription");
  });

  it("prepaid-aware disambiguator names all THREE systems (spec 038, decision 42 amended)", () => {
    const v = PRICING_MODEL.disambiguatorWithPrepaid;
    // Still a subscription (keeps the base contract token) …
    expect(v.ar).toContain("اشتراك");
    expect(v.en.toLowerCase()).toContain("subscription");
    // … and now names the prepaid / pay-as-you-go option too.
    expect(v.ar).toContain("مدفوعة مسبقاً");
    expect(v.en.toLowerCase()).toContain("prepaid");
  });

  it("prepaid hours policy: 60-minute unit stated, pay-as-you-go framing (spec 038)", () => {
    expect(PREPAID_HOURS_POLICY.long.ar).toContain("٦٠");
    expect(PREPAID_HOURS_POLICY.long.en).toContain("60");
    expect(PREPAID_HOURS_POLICY.short.en.toLowerCase()).toContain("pay as you go");
    expect(PREPAID_HOURS_POLICY.short.ar).toContain("مدفوعة مسبقاً");
    // Expiry is stated as a RULE in both variants…
    expect(PREPAID_HOURS_POLICY.long.ar).toMatch(/تنتهي|الانتهاء/);
    expect(PREPAID_HOURS_POLICY.long.en.toLowerCase()).toContain("expire");
    // …but the window is DRIFT-PROOF: copy must never hardcode a month count
    // (the authoritative window is the prepaid_hours_expiry_months setting,
    // shown per-lot in the wallet). Guard against "12 month(s)" / "١٢ شهر".
    expect(PREPAID_HOURS_POLICY.long.en.toLowerCase()).not.toMatch(/\d+\s*month/);
    expect(PREPAID_HOURS_POLICY.long.ar).not.toMatch(/[٠-٩]+\s*شهر/);
  });
});
