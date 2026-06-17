import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase.generated";

vi.mock("@/lib/settings", () => ({
  getSetting: vi.fn(),
}));

import { getSetting } from "@/lib/settings";
import { resolveGuardianDiscount, recordDiscount } from "./discounts";

const mockGetSetting = vi.mocked(getSetting);

function makeAdmin(overrides: {
  guardian_children?: { data: unknown; error: unknown };
  subscriptions?: { data: unknown; error: unknown };
  packages?: { data: unknown; error: unknown };
  "subscription_discount_records:insert"?: { error: unknown };
}): SupabaseClient<Database> {
  const gc = overrides.guardian_children ?? { data: [], error: null };
  const subs = overrides.subscriptions ?? { data: [], error: null };
  // Default: one matching package (discount check passes) — tests that need no
  // discount set packages to { data: [], error: null } explicitly.
  const pkgs = overrides.packages ?? { data: [{ id: "pkg-001" }], error: null };
  const insertResult = overrides["subscription_discount_records:insert"] ?? { error: null };

  // Generic chainable builder for multi-.eq() + limit/not queries.
  function chain(result: unknown) {
    const c: Record<string, unknown> = {
      eq: () => c,
      in: () => c,
      not: () => c,
      limit: () => Promise.resolve(result),
      then: undefined,
    };
    // Allow awaiting the chain directly (without .limit()).
    Object.defineProperty(c, "then", {
      get() {
        return (resolve: (v: unknown) => void) => resolve(result);
      },
    });
    return c;
  }

  return {
    from: vi.fn((table: string) => {
      if (table === "guardian_children") {
        return { select: vi.fn(() => chain(gc)) };
      }
      if (table === "subscriptions") {
        return { select: vi.fn(() => chain(subs)) };
      }
      if (table === "packages") {
        return { select: vi.fn(() => chain(pkgs)) };
      }
      if (table === "subscription_discount_records") {
        return { insert: vi.fn(() => Promise.resolve(insertResult)) };
      }
      return {};
    }),
  } as unknown as SupabaseClient<Database>;
}

const GUARDIAN_ID = "guardian-001";
const CHILD_ID_1 = "child-001";
const CHILD_ID_2 = "child-002";
const SUB_ID = "sub-001";

const activeIndividualSub = {
  id: SUB_ID,
  student_id: CHILD_ID_1,
  plan_id: "plan-001",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSetting.mockResolvedValue(null);
});

describe("resolveGuardianDiscount", () => {
  it("returns no discount when guardian has no children", async () => {
    const admin = makeAdmin({ guardian_children: { data: [], error: null } });
    const result = await resolveGuardianDiscount(admin, GUARDIAN_ID, "hifz_individual");
    expect(result.applies).toBe(false);
  });

  it("returns no discount when children have no active hifz subscriptions", async () => {
    const admin = makeAdmin({
      guardian_children: { data: [{ child_id: CHILD_ID_1 }], error: null },
      subscriptions: { data: [], error: null },
    });
    const result = await resolveGuardianDiscount(admin, GUARDIAN_ID, "hifz_individual");
    expect(result.applies).toBe(false);
  });

  it("returns second_individual discount when setting is configured", async () => {
    mockGetSetting.mockResolvedValue("15");
    const admin = makeAdmin({
      guardian_children: {
        data: [{ child_id: CHILD_ID_1 }, { child_id: CHILD_ID_2 }],
        error: null,
      },
      subscriptions: { data: [activeIndividualSub], error: null },
    });

    const result = await resolveGuardianDiscount(admin, GUARDIAN_ID, "hifz_individual");

    expect(result.applies).toBe(true);
    if (result.applies) {
      expect(result.discountType).toBe("second_individual");
      expect(result.discountPct).toBe(15);
      expect(result.settingKey).toBe("hifz_second_individual_discount_pct");
    }
  });

  it("returns no discount when setting is zero", async () => {
    mockGetSetting.mockResolvedValue("0");
    const admin = makeAdmin({
      guardian_children: { data: [{ child_id: CHILD_ID_1 }], error: null },
      subscriptions: { data: [activeIndividualSub], error: null },
    });

    const result = await resolveGuardianDiscount(admin, GUARDIAN_ID, "hifz_individual");
    expect(result.applies).toBe(false);
  });

  it("returns sibling_group discount for hifz_group", async () => {
    mockGetSetting.mockResolvedValue("10");
    const admin = makeAdmin({
      guardian_children: { data: [{ child_id: CHILD_ID_1 }], error: null },
      subscriptions: { data: [activeIndividualSub], error: null },
    });

    const result = await resolveGuardianDiscount(admin, GUARDIAN_ID, "hifz_group");

    expect(result.applies).toBe(true);
    if (result.applies) {
      expect(result.discountType).toBe("sibling_group");
      expect(result.discountPct).toBe(10);
    }
  });

  it("returns no discount on guardian_children db error", async () => {
    const admin = makeAdmin({
      guardian_children: { data: null, error: { message: "db error" } },
    });

    const result = await resolveGuardianDiscount(admin, GUARDIAN_ID, "hifz_individual");
    expect(result.applies).toBe(false);
  });

  it("ignores non-hifz product_category", async () => {
    mockGetSetting.mockResolvedValue("15");
    const admin = makeAdmin({
      guardian_children: { data: [{ child_id: CHILD_ID_1 }], error: null },
      subscriptions: { data: [activeIndividualSub], error: null },
    });

    const result = await resolveGuardianDiscount(admin, GUARDIAN_ID, "tajweed");
    expect(result.applies).toBe(false);
  });

  it("throws when package query fails", async () => {
    mockGetSetting.mockResolvedValue("15");
    const admin = makeAdmin({
      guardian_children: { data: [{ child_id: CHILD_ID_1 }, { child_id: CHILD_ID_2 }], error: null },
      subscriptions: { data: [activeIndividualSub], error: null },
      packages: { data: null, error: { message: "packages db error" } },
    });

    await expect(resolveGuardianDiscount(admin, GUARDIAN_ID, "hifz_individual"))
      .rejects.toThrow("packages db error");
  });
});

describe("recordDiscount", () => {
  it("inserts into subscription_discount_records", async () => {
    const insertFn = vi.fn(() => Promise.resolve({ error: null }));
    const admin = {
      from: vi.fn(() => ({ insert: insertFn })),
    } as unknown as SupabaseClient<Database>;

    await recordDiscount(admin, SUB_ID, {
      applies: true,
      discountType: "second_individual",
      discountPct: 15,
      settingKey: "hifz_second_individual_discount_pct",
    });

    expect(insertFn).toHaveBeenCalledWith({
      subscription_id: SUB_ID,
      discount_type: "second_individual",
      discount_pct: 15,
      setting_key: "hifz_second_individual_discount_pct",
    });
  });

  it("does not throw on insert error", async () => {
    const admin = {
      from: vi.fn(() => ({
        insert: vi.fn(() => Promise.resolve({ error: { message: "db error", code: "23000" } })),
      })),
    } as unknown as SupabaseClient<Database>;

    await expect(
      recordDiscount(admin, SUB_ID, {
        applies: true,
        discountType: "sibling_group",
        discountPct: 10,
        settingKey: "hifz_sibling_group_discount_pct",
      }),
    ).resolves.toBeUndefined();
  });
});
