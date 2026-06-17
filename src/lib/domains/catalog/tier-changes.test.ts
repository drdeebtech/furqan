import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase.generated";

import {
  canUpgradeImmediately,
  scheduleRenewalChange,
  type CurrentTierInfo,
  type NewTierInfo,
} from "./tier-changes";

// ── canUpgradeImmediately ──────────────────────────────────────────────────────

const base: CurrentTierInfo = {
  subscriptionId: "sub-001",
  stripeSubscriptionId: "sub_stripe_001",
  planId: "plan-001",
  packageId: "pkg-001",
  productCategory: "hifz_individual",
  sessionsPerMonth: 4,
  currentPeriodEnd: "2026-07-01T00:00:00Z",
};

const higherIndividual: NewTierInfo = {
  packageId: "pkg-002",
  planId: "plan-002",
  productCategory: "hifz_individual",
  sessionsPerMonth: 8,
};

describe("canUpgradeImmediately", () => {
  it("allows immediate upgrade in same category with more sessions", () => {
    const result = canUpgradeImmediately(base, higherIndividual);
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.deltaSessions).toBe(4);
    }
  });

  it("rejects type mismatch (individual → group)", () => {
    const result = canUpgradeImmediately(base, {
      ...higherIndividual,
      productCategory: "hifz_group",
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe("type_mismatch");
    }
  });

  it("rejects same session count (lateral move)", () => {
    const result = canUpgradeImmediately(base, {
      ...higherIndividual,
      sessionsPerMonth: 4,
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe("not_an_upgrade");
    }
  });

  it("rejects downgrade (fewer sessions)", () => {
    const result = canUpgradeImmediately(base, {
      ...higherIndividual,
      sessionsPerMonth: 2,
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe("not_an_upgrade");
    }
  });

  it("computes correct deltaSessions for 4→12", () => {
    const result = canUpgradeImmediately(base, {
      ...higherIndividual,
      sessionsPerMonth: 12,
    });
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.deltaSessions).toBe(8);
    }
  });
});

// ── scheduleRenewalChange ─────────────────────────────────────────────────────

function makeAdmin(overrides: {
  cancel?: { error: unknown };
  insert?: { data: unknown; error: unknown };
}): SupabaseClient<Database> {
  const cancelRes = overrides.cancel ?? { error: null };
  const insertRes = overrides.insert ?? { data: { id: "ptc-001" }, error: null };

  return {
    from: vi.fn((table: string) => {
      if (table === "pending_tier_changes") {
        return {
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => Promise.resolve(cancelRes)),
            })),
          })),
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn(() => Promise.resolve(insertRes)),
            })),
          })),
        };
      }
      return {};
    }),
  } as unknown as SupabaseClient<Database>;
}

describe("scheduleRenewalChange", () => {
  const opts = {
    subscriptionId: "sub-001",
    studentId: "student-001",
    fromPackageId: "pkg-001",
    toPackageId: "pkg-002",
    changeReason: "downgrade" as const,
  };

  it("returns { id } on success", async () => {
    const admin = makeAdmin({});
    const result = await scheduleRenewalChange(admin, opts);
    expect(result).toEqual({ id: "ptc-001" });
  });

  it("returns null on insert error", async () => {
    const admin = makeAdmin({
      insert: { data: null, error: { message: "db error", code: "23000" } },
    });
    const result = await scheduleRenewalChange(admin, opts);
    expect(result).toBeNull();
  });

  it("proceeds with insert even when cancel fails", async () => {
    const admin = makeAdmin({
      cancel: { error: { message: "cancel failed" } },
      insert: { data: { id: "ptc-002" }, error: null },
    });
    const result = await scheduleRenewalChange(admin, opts);
    expect(result).toEqual({ id: "ptc-002" });
  });
});
