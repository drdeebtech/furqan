import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

import {
  HifzAlreadyActiveError,
  InvalidHifzPlanError,
  hasActiveHifzSubscription,
  assertNoActiveHifz,
  isPlanHifzProduct,
} from "./create-hifz-subscription";

// ─── Mock builders ──────────────────────────────────────────────────────────

/**
 * Build a mock admin client whose query chain ends with a result object.
 * `hasActiveHifzSubscription` chain: from → select → eq → eq → not → await {count}
 * `isPlanHifzProduct` chain: from → select → eq → maybeSingle → await {data}
 */
function makeCountAdmin(count: number | null) {
  const terminal = Promise.resolve({ count });
  const not = vi.fn(() => terminal);
  const eq2 = vi.fn(() => ({ not }));
  const eq1 = vi.fn(() => ({ eq: eq2 }));
  const select = vi.fn(() => ({ eq: eq1 }));
  return { from: vi.fn(() => ({ select })) } as never;
}

function maybeSingleFn(data: unknown) {
  return Promise.resolve({ data });
}

function makeDataAdmin(data: unknown) {
  const maybeSingle = vi.fn(() => maybeSingleFn(data));
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
});
