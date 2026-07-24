import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
}));

import {
  PLANS,
  assertPlanPriceMatches,
  buildMigration,
  isProductionBase,
  migrationTimestamp,
  planNameFor,
  productNameForFamily,
  type ResolvedPlan,
} from "../paypal-bootstrap-plans";

describe("paypal-bootstrap-plans pure helpers", () => {
  it("buildMigration emits one escaped update per resolved plan and fail-closed SQL", () => {
    const resolved: readonly ResolvedPlan[] = PLANS.map((plan, index) => ({
      planCode: plan.planCode,
      productId: `PROD-${index + 1}`,
      planId: index === 0 ? "P-'LAN-1" : `P-LAN-${index + 1}`,
      reused: true,
    }));

    const sql = buildMigration(resolved, "2026-08-17T09:08:07.000Z");

    expect(sql).toContain("begin;\n");
    expect(sql).toContain("commit;\n");
    expect(sql.match(/update public\.subscription_plans set paypal_plan_id/g)).toHaveLength(
      PLANS.length,
    );
    for (const plan of PLANS) {
      const resolvedPlan = resolved.find((r) => r.planCode === plan.planCode);
      expect(resolvedPlan).toBeDefined();
      const escapedPlanId = resolvedPlan?.planId.replace(/'/g, "''");
      expect(sql).toContain(
        `update public.subscription_plans set paypal_plan_id = '${escapedPlanId}' where plan_code = '${plan.planCode}';`,
      );
    }
    expect(sql).toContain(
      "where is_hifz_product and paypal_plan_id is null",
    );
    expect(sql).toContain(
      "raise exception 'hifz plan missing paypal_plan_id';",
    );

    expect(
      buildMigration(
        [
          {
            planCode: "hifz_group_4'quoted",
            productId: "PROD-1",
            planId: "P-'LAN-1",
            reused: false,
          },
        ],
        "2026-08-17T09:08:07.000Z",
      ),
    ).toContain(
      "paypal_plan_id = 'P-''LAN-1' where plan_code = 'hifz_group_4''quoted';",
    );
  });

  it("assertPlanPriceMatches passes on exact value and names drift details", () => {
    expect(() => assertPlanPriceMatches(PLANS[0], "12.00")).not.toThrow();

    expect(() => assertPlanPriceMatches(PLANS[0], "12.01")).toThrow(
      /hifz_group_4.*12\.01.*12\.00/,
    );
  });

  it("isProductionBase distinguishes live from sandbox", () => {
    expect(isProductionBase("https://api-m.paypal.com")).toBe(true);
    expect(isProductionBase("https://api-m.sandbox.paypal.com")).toBe(false);
  });

  it("planNameFor and productNameForFamily return exact PayPal names", () => {
    expect(planNameFor("hifz_group_4")).toBe("furqan-hifz_group_4");
    expect(productNameForFamily("Group")).toBe("Furqan Hifz Group");
  });

  it("migrationTimestamp is deterministic UTC YYYYMMDDHHMMSS", () => {
    expect(migrationTimestamp(new Date("2026-08-17T09:08:07.000Z"))).toBe(
      "20260817090807",
    );
  });

  it("PLANS carries the exact hifz price ladder cents", () => {
    expect(Object.fromEntries(PLANS.map((plan) => [plan.planCode, plan.priceCents]))).toEqual({
      hifz_group_4: 1200,
      hifz_group_6: 1500,
      hifz_group_8: 1800,
      hifz_individual_4h: 4400,
      hifz_individual_6h: 6000,
      hifz_individual_8h: 7200,
    });
  });
});
