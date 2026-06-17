import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

// Mock unstable_cache to pass through (test the real function body).
vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}));

// Mock admin client with a chainable query builder.
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockOrder = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: vi.fn(() => ({
      select: mockSelect,
    })),
  }),
}));

import { getActiveCatalogTiers } from "./tiers";

/**
 * Spec 019 / T009 — catalog tiers unit tests.
 *
 * Covers: DB row mapping (group vs individual), price formatting,
 * archived/inactive tiers excluded, sorting order.
 */
describe("getActiveCatalogTiers", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Chainable mock: select → eq → eq → order → { data, error }
    mockSelect.mockReturnValue({
      eq: mockEq,
    });
    mockEq.mockReturnValue({
      eq: mockEq,
      order: mockOrder,
    });
    mockOrder.mockReturnValue({
      eq: mockEq,
    });
  });

  it("maps group and individual tiers with correct type and price", async () => {
    mockOrder.mockReturnValueOnce({
      data: [
        {
          id: "pkg-1",
          name: "Hifz Group 4",
          product_category: "hifz_group",
          price_usd: "12.00",
          subscription_plan_id: "plan-1",
          subscription_plans: { sessions_per_month: 4, session_duration_min: 60 },
        },
        {
          id: "pkg-4",
          name: "Hifz Individual 4h",
          product_category: "hifz_individual",
          price_usd: "40.00",
          subscription_plan_id: "plan-4",
          subscription_plans: { sessions_per_month: 4, session_duration_min: 60 },
        },
      ],
      error: null,
    });

    const tiers = await getActiveCatalogTiers();

    expect(tiers).toHaveLength(2);
    expect(tiers[0].tier_type).toBe("group");
    expect(tiers[0].price_usd).toBe("12.00");
    expect(tiers[0].sessions_per_month).toBe(4);
    expect(tiers[0].session_duration_minutes).toBe(60);
    expect(tiers[0].plan_id).toBe("plan-1");
    expect(tiers[0].package_id).toBe("pkg-1");

    expect(tiers[1].tier_type).toBe("individual");
    expect(tiers[1].price_usd).toBe("40.00");
  });

  it("sorts group tiers before individual, then sessions ascending", async () => {
    mockOrder.mockReturnValueOnce({
      data: [
        {
          id: "pkg-ind-8",
          name: "Individual 8h",
          product_category: "hifz_individual",
          price_usd: "80.00",
          subscription_plan_id: "plan-i8",
          subscription_plans: { sessions_per_month: 8, session_duration_min: 60 },
        },
        {
          id: "pkg-grp-8",
          name: "Group 8",
          product_category: "hifz_group",
          price_usd: "20.00",
          subscription_plan_id: "plan-g8",
          subscription_plans: { sessions_per_month: 8, session_duration_min: 60 },
        },
        {
          id: "pkg-grp-4",
          name: "Group 4",
          product_category: "hifz_group",
          price_usd: "12.00",
          subscription_plan_id: "plan-g4",
          subscription_plans: { sessions_per_month: 4, session_duration_min: 60 },
        },
      ],
      error: null,
    });

    const tiers = await getActiveCatalogTiers();

    expect(tiers).toHaveLength(3);
    expect(tiers[0].id).toBe("pkg-grp-4");
    expect(tiers[1].id).toBe("pkg-grp-8");
    expect(tiers[2].id).toBe("pkg-ind-8");
  });

  it("excludes rows with missing subscription_plan_id", async () => {
    mockOrder.mockReturnValueOnce({
      data: [
        {
          id: "pkg-bad",
          name: "Bad Tier",
          product_category: "hifz_group",
          price_usd: "10.00",
          subscription_plan_id: null,
          subscription_plans: { sessions_per_month: 4, session_duration_min: 60 },
        },
        {
          id: "pkg-good",
          name: "Good Tier",
          product_category: "hifz_group",
          price_usd: "12.00",
          subscription_plan_id: "plan-good",
          subscription_plans: { sessions_per_month: 4, session_duration_min: 60 },
        },
      ],
      error: null,
    });

    const tiers = await getActiveCatalogTiers();
    expect(tiers).toHaveLength(1);
    expect(tiers[0].id).toBe("pkg-good");
  });

  it("returns empty array on DB error", async () => {
    mockOrder.mockReturnValueOnce({
      data: null,
      error: { message: "connection refused" },
    });

    const tiers = await getActiveCatalogTiers();
    expect(tiers).toEqual([]);
  });

  it("formats price_usd as 2-decimal string", async () => {
    mockOrder.mockReturnValueOnce({
      data: [
        {
          id: "pkg-1",
          name: "Group 6",
          product_category: "hifz_group",
          price_usd: 15,
          subscription_plan_id: "plan-1",
          subscription_plans: { sessions_per_month: 6, session_duration_min: 60 },
        },
      ],
      error: null,
    });

    const tiers = await getActiveCatalogTiers();
    expect(tiers[0].price_usd).toBe("15.00");
  });
});
