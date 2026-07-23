import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  PREPAID_DEFAULT_RATE_USD,
  PREPAID_DEFAULT_CUSTOM_MIN,
  PREPAID_DEFAULT_CUSTOM_MAX,
} from "./prepaid-defaults";

const { mockGetSetting } = vi.hoisted(() => ({ mockGetSetting: vi.fn() }));
vi.mock("@/lib/settings", () => ({ getSetting: mockGetSetting }));

import { resolvePrepaidQuote, PrepaidHoursOutOfRangeError } from "./prepaid-quote";

function mockSettings(values: Record<string, string>) {
  mockGetSetting.mockImplementation(async (key: string) => values[key] ?? null);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolvePrepaidQuote", () => {
  // ── Nominal ──────────────────────────────────────────────────────────────
  it("computes amountCents = round(hours × rate × 100) at the seeded default", async () => {
    mockSettings({});
    const quote = await resolvePrepaidQuote(10);
    expect(quote.rateUsd).toBe(PREPAID_DEFAULT_RATE_USD);
    expect(quote.amountCents).toBe(Math.round(10 * PREPAID_DEFAULT_RATE_USD * 100));
  });

  it("falls back to the seeded default rate when the setting is missing/malformed", async () => {
    mockSettings({ prepaid_hours_rate_usd: "not-a-number" });
    const quote = await resolvePrepaidQuote(1);
    expect(quote.rateUsd).toBe(PREPAID_DEFAULT_RATE_USD);
  });

  // ── Custom bounds ────────────────────────────────────────────────────────
  it("honors custom bounds from settings", async () => {
    mockSettings({
      prepaid_hours_rate_usd: "10",
      prepaid_hours_custom_min: "5",
      prepaid_hours_custom_max: "20",
    });
    const quote = await resolvePrepaidQuote(15);
    expect(quote.min).toBe(5);
    expect(quote.max).toBe(20);
  });

  // ── Inverted bounds: RESET, not swap ────────────────────────────────────
  it("resets inverted bounds to defaults rather than swapping them", async () => {
    // Admin sets min=200, leaves max missing/invalid → resolves to
    // DEFAULT_CUSTOM_MAX=100, which is < min=200. Must reset BOTH to the
    // seeded defaults (1..100), never swap to (100..200).
    mockSettings({ prepaid_hours_custom_min: "200" });
    const quote = await resolvePrepaidQuote(PREPAID_DEFAULT_CUSTOM_MIN);
    expect(quote.min).toBe(PREPAID_DEFAULT_CUSTOM_MIN);
    expect(quote.max).toBe(PREPAID_DEFAULT_CUSTOM_MAX);
  });

  // ── Out-of-range signal (routes turn this into their 422) ──────────────
  it("rejects below the custom min with PrepaidHoursOutOfRangeError", async () => {
    mockSettings({ prepaid_hours_custom_min: "5", prepaid_hours_custom_max: "20" });
    await expect(resolvePrepaidQuote(2)).rejects.toBeInstanceOf(PrepaidHoursOutOfRangeError);
  });

  it("rejects above the custom max with PrepaidHoursOutOfRangeError", async () => {
    mockSettings({ prepaid_hours_custom_min: "1", prepaid_hours_custom_max: "20" });
    await expect(resolvePrepaidQuote(50)).rejects.toBeInstanceOf(PrepaidHoursOutOfRangeError);
  });

  it("the error message names the actual resolved bounds (routes' 422 body text)", async () => {
    mockSettings({ prepaid_hours_custom_min: "5", prepaid_hours_custom_max: "20" });
    await expect(resolvePrepaidQuote(2)).rejects.toThrow("Hours must be between 5 and 20");
  });

  // ── Money proof: hand-computed cents at custom rate + bounds ───────────
  it.each([
    { hours: 3, rate: "7.5", min: "1", max: "10", expectedCents: 2250 },
    { hours: 6, rate: "12.25", min: "1", max: "10", expectedCents: 7350 },
  ])(
    "hand-computed: $hours h at \\$$rate/h -> $expectedCents cents",
    async ({ hours, rate, min, max, expectedCents }) => {
      mockSettings({
        prepaid_hours_rate_usd: rate,
        prepaid_hours_custom_min: min,
        prepaid_hours_custom_max: max,
      });
      const quote = await resolvePrepaidQuote(hours);
      expect(quote.amountCents).toBe(expectedCents);
    },
  );

  // ── Negative control: the probe must be able to fail ────────────────────
  it("NEGATIVE CONTROL: a tampered rate yields a different, detectable amount", async () => {
    mockSettings({ prepaid_hours_rate_usd: "10", prepaid_hours_custom_min: "1", prepaid_hours_custom_max: "10" });
    const honest = await resolvePrepaidQuote(5);

    mockSettings({ prepaid_hours_rate_usd: "999", prepaid_hours_custom_min: "1", prepaid_hours_custom_max: "10" });
    const tampered = await resolvePrepaidQuote(5);

    // If the rate had no effect on amountCents this assertion would catch
    // it — proving the probe above can actually fail, not just pass.
    expect(tampered.amountCents).not.toBe(honest.amountCents);
    expect(tampered.amountCents).toBe(Math.round(5 * 999 * 100));
  });
});
