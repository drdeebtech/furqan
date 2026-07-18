import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/settings", () => ({
  getSetting: vi.fn(),
}));

import { getSetting } from "@/lib/settings";
import {
  getAssessmentPrice,
  getInstantPrice,
  getSpecializedPrice,
  SPECIALIZED_PURPOSES,
} from "./pricing";

const mockGetSetting = vi.mocked(getSetting);

/**
 * Spec 022 / T014 — pricing module.
 *
 * The defining contract: prices are configuration data stored in
 * `platform_settings`, never hardcoded (FR-002 / SC-006). Every getter reads
 * the value fresh at call time so an admin's update is reflected on the next
 * booking. The `0.00` seed default means "free-by-default until an admin
 * configures a price" (data-model §4).
 */
describe("single-session pricing (spec 022 / T014)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exposes 4 specialized purposes matching the DB enum", () => {
    expect(SPECIALIZED_PURPOSES).toEqual([
      "review",
      "consolidate_surah",
      "memorize_mutoon",
      "test_juz_mutashabihat",
    ]);
  });

  it("returns the configured assessment price", async () => {
    mockGetSetting.mockResolvedValueOnce("5.00");
    expect(await getAssessmentPrice()).toBe(5);
  });

  it("returns 0 (free) when assessment price is '0.00'", async () => {
    mockGetSetting.mockResolvedValueOnce("0.00");
    expect(await getAssessmentPrice()).toBe(0);
  });

  it("returns the configured instant price", async () => {
    mockGetSetting.mockResolvedValueOnce("7.5");
    expect(await getInstantPrice()).toBe(7.5);
  });

  it("returns the configured specialized price per purpose", async () => {
    mockGetSetting.mockResolvedValueOnce("3.00");
    expect(await getSpecializedPrice("review")).toBe(3);

    mockGetSetting.mockResolvedValueOnce("8.00");
    expect(await getSpecializedPrice("consolidate_surah")).toBe(8);

    mockGetSetting.mockResolvedValueOnce("15.00");
    expect(await getSpecializedPrice("memorize_mutoon")).toBe(15);

    mockGetSetting.mockResolvedValueOnce("10.00");
    expect(await getSpecializedPrice("test_juz_mutashabihat")).toBe(10);
  });

  it("reads from platform_settings (never hardcoded) — calls getSetting with the correct key", async () => {
    mockGetSetting.mockResolvedValue("1.00");
    await getAssessmentPrice();
    await getInstantPrice();
    await getSpecializedPrice("review");
    await getSpecializedPrice("consolidate_surah");
    await getSpecializedPrice("memorize_mutoon");
    await getSpecializedPrice("test_juz_mutashabihat");

    const keysRequested = mockGetSetting.mock.calls.map((c) => c[0]);
    expect(keysRequested).toContain("single_session_assessment_price_usd");
    expect(keysRequested).toContain("single_session_instant_price_usd");
    expect(keysRequested).toContain("single_session_review_price_usd");
    expect(keysRequested).toContain("single_session_consolidate_surah_price_usd");
    expect(keysRequested).toContain("single_session_memorize_mutoon_price_usd");
    expect(keysRequested).toContain("single_session_test_juz_price_usd");
  });

  it("defaults to 0 (free) when the setting is missing/unconfigured", async () => {
    mockGetSetting.mockResolvedValueOnce(null);
    expect(await getAssessmentPrice()).toBe(0);
  });

  it("throws on a configured non-numeric value (fail-closed — never silently free)", async () => {
    mockGetSetting.mockResolvedValueOnce("not-a-number");
    await expect(getAssessmentPrice()).rejects.toThrow(/corrupt/);
  });

  it("throws on a configured empty-string value (fail-closed)", async () => {
    mockGetSetting.mockResolvedValueOnce("  ");
    await expect(getAssessmentPrice()).rejects.toThrow(/corrupt/);
  });

  it("throws on a configured negative price (fail-closed — never refund-on-creation)", async () => {
    mockGetSetting.mockResolvedValueOnce("-5.00");
    await expect(getInstantPrice()).rejects.toThrow(/corrupt/);
  });

  it("throws on an unknown specialized purpose (defense in depth)", async () => {
    await expect(
      // @ts-expect-error — intentionally passing an invalid purpose
      getSpecializedPrice("nonexistent_purpose"),
    ).rejects.toThrow(/unknown specialized purpose/);
  });
});
