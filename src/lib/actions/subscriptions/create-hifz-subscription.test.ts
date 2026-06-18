import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/domains/catalog/discounts", () => ({
  resolveGuardianDiscount: vi.fn(),
  recordDiscount: vi.fn(),
}));

import {
  HifzAlreadyActiveError,
  InvalidHifzPlanError,
  hasActiveHifzSubscription,
  assertNoActiveHifz,
  isPlanHifzProduct,
  resolveStudentFamilyDiscount,
} from "./create-hifz-subscription";
import { resolveGuardianDiscount } from "@/lib/domains/catalog/discounts";

// ─── Mock builders ──────────────────────────────────────────────────────────

type QueryError = { message: string; code?: string } | null;

/**
 * Build a mock admin client whose query chain ends with a result object.
 * `hasActiveHifzSubscription` chain: from → select → eq → eq → not → await {count}
 * `isPlanHifzProduct` chain: from → select → eq → maybeSingle → await {data}
 */
function makeCountAdmin(count: number | null, error: QueryError = null) {
  const terminal = Promise.resolve({ count, error });
  const not = vi.fn(() => terminal);
  const eq2 = vi.fn(() => ({ not }));
  const eq1 = vi.fn(() => ({ eq: eq2 }));
  const select = vi.fn(() => ({ eq: eq1 }));
  return { from: vi.fn(() => ({ select })) } as never;
}

function maybeSingleFn(data: unknown, error: QueryError = null) {
  return Promise.resolve({ data, error });
}

function makeDataAdmin(data: unknown, error: QueryError = null) {
  const maybeSingle = vi.fn(() => maybeSingleFn(data, error));
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  return { from: vi.fn(() => ({ select })) } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Error class tests ──────────────────────────────────────────────────────

describe("HifzAlreadyActiveError", () => {
  it("has correct name and default message", () => {
    const err = new HifzAlreadyActiveError();
    expect(err.name).toBe("HifzAlreadyActiveError");
    expect(err.message).toContain("active hifz");
  });

  it("accepts custom message", () => {
    const err = new HifzAlreadyActiveError("Custom");
    expect(err.message).toBe("Custom");
  });

  it("extends Error", () => {
    const err = new HifzAlreadyActiveError();
    expect(err).toBeInstanceOf(Error);
  });
});

describe("InvalidHifzPlanError", () => {
  it("has correct name and default message", () => {
    const err = new InvalidHifzPlanError();
    expect(err.name).toBe("InvalidHifzPlanError");
    expect(err.message).toContain("Invalid");
  });
});

// ─── hasActiveHifzSubscription ──────────────────────────────────────────────

describe("hasActiveHifzSubscription", () => {
  it("returns true when count > 0", async () => {
    const admin = makeCountAdmin(1);
    expect(await hasActiveHifzSubscription(admin, "stu-1")).toBe(true);
  });

  it("returns false when count = 0", async () => {
    const admin = makeCountAdmin(0);
    expect(await hasActiveHifzSubscription(admin, "stu-1")).toBe(false);
  });

  it("returns false when count is null", async () => {
    const admin = makeCountAdmin(null);
    expect(await hasActiveHifzSubscription(admin, "stu-1")).toBe(false);
  });

  it("throws when query returns an error", async () => {
    const admin = makeCountAdmin(null, { message: "db error" });
    await expect(hasActiveHifzSubscription(admin, "stu-1")).rejects.toThrow("db error");
  });
});

// ─── assertNoActiveHifz ─────────────────────────────────────────────────────

describe("assertNoActiveHifz", () => {
  it("throws HifzAlreadyActiveError when active hifz exists", async () => {
    const admin = makeCountAdmin(1);
    await expect(assertNoActiveHifz(admin, "stu-1")).rejects.toThrow(HifzAlreadyActiveError);
  });

  it("does NOT throw when no active hifz exists", async () => {
    const admin = makeCountAdmin(0);
    await expect(assertNoActiveHifz(admin, "stu-1")).resolves.toBeUndefined();
  });
});

// ─── resolveStudentFamilyDiscount ───────────────────────────────────────────

function makeGuardianAdmin(
  guardians: Array<{ guardian_id: string }> | null,
  error: { message: string } | null = null,
) {
  const result = Promise.resolve({ data: guardians, error });
  const eq = vi.fn(() => result);
  const select = vi.fn(() => ({ eq }));
  return { from: vi.fn(() => ({ select })) } as never;
}

describe("resolveStudentFamilyDiscount", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns { applies: false } when student has no guardians", async () => {
    const admin = makeGuardianAdmin([]);
    const result = await resolveStudentFamilyDiscount(admin, "stu-1", "hifz_group");
    expect(result.applies).toBe(false);
    expect(resolveGuardianDiscount).not.toHaveBeenCalled();
  });

  it("fails open when guardian_children query errors", async () => {
    const admin = makeGuardianAdmin(null, { message: "db error" });
    const result = await resolveStudentFamilyDiscount(admin, "stu-1", "hifz_group");
    expect(result.applies).toBe(false);
    expect(resolveGuardianDiscount).not.toHaveBeenCalled();
  });

  it("returns the highest discount when multiple guardians have discounts", async () => {
    const admin = makeGuardianAdmin([{ guardian_id: "g-1" }, { guardian_id: "g-2" }]);
    vi.mocked(resolveGuardianDiscount)
      .mockResolvedValueOnce({ applies: true, discountPct: 10, discountType: "sibling_group", settingKey: "k1" })
      .mockResolvedValueOnce({ applies: true, discountPct: 15, discountType: "second_individual", settingKey: "k2" });

    const result = await resolveStudentFamilyDiscount(admin, "stu-1", "hifz_group");
    expect(result.applies).toBe(true);
    if (result.applies) expect(result.discountPct).toBe(15);
  });

  it("returns successful guardian discount when one guardian throws", async () => {
    const admin = makeGuardianAdmin([{ guardian_id: "g-1" }, { guardian_id: "g-2" }]);
    vi.mocked(resolveGuardianDiscount)
      .mockRejectedValueOnce(new Error("lookup failed"))
      .mockResolvedValueOnce({ applies: true, discountPct: 10, discountType: "sibling_group", settingKey: "k1" });

    const result = await resolveStudentFamilyDiscount(admin, "stu-1", "hifz_group");
    expect(result.applies).toBe(true);
    if (result.applies) expect(result.discountPct).toBe(10);
  });
});

// ─── isPlanHifzProduct ──────────────────────────────────────────────────────

describe("isPlanHifzProduct", () => {
  it("returns true when plan is_hifz_product = true", async () => {
    const admin = makeDataAdmin({ is_hifz_product: true });
    expect(await isPlanHifzProduct(admin, "plan-1")).toBe(true);
  });

  it("returns false when plan is_hifz_product = false", async () => {
    const admin = makeDataAdmin({ is_hifz_product: false });
    expect(await isPlanHifzProduct(admin, "plan-1")).toBe(false);
  });

  it("returns false when plan not found (data null)", async () => {
    const admin = makeDataAdmin(null);
    expect(await isPlanHifzProduct(admin, "plan-missing")).toBe(false);
  });

  it("throws when query returns an error", async () => {
    const admin = makeDataAdmin(null, { message: "db error" });
    await expect(isPlanHifzProduct(admin, "plan-1")).rejects.toThrow("db error");
  });
});
