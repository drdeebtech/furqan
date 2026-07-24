import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildSubscriptionCustomId,
  parseSubscriptionCustomId,
} from "../subscription-custom-id";

const STUDENT_ID = "00000000-0000-4000-8000-000000000001";

describe("subscription custom_id codec", () => {
  it("round-trips subscription custom_id fields without extra", () => {
    const customId = buildSubscriptionCustomId({
      productType: "subscription",
      studentId: STUDENT_ID,
      planCode: "monthly",
    });

    expect(parseSubscriptionCustomId(customId)).toEqual({
      productType: "subscription",
      studentId: STUDENT_ID,
      planCode: "monthly",
      extra: null,
    });
  });

  it("round-trips subscription upgrade custom_id fields with extra", () => {
    const customId = buildSubscriptionCustomId({
      productType: "subscription_upgrade",
      studentId: STUDENT_ID,
      planCode: "pro",
      extra: "upgrade-grant-1",
    });

    expect(parseSubscriptionCustomId(customId)).toEqual({
      productType: "subscription_upgrade",
      studentId: STUDENT_ID,
      planCode: "pro",
      extra: "upgrade-grant-1",
    });
  });

  it("throws when the built custom_id exceeds PayPal's 127-character cap", () => {
    expect(() =>
      buildSubscriptionCustomId({
        productType: "subscription_upgrade",
        studentId: STUDENT_ID,
        planCode: "plan",
        extra: "x".repeat(90),
      }),
    ).toThrow("PayPal custom_id exceeds 127 characters.");
  });

  it("rejects a wrong version prefix", () => {
    expect(
      parseSubscriptionCustomId(`v2|subscription|${STUDENT_ID}|monthly`),
    ).toBeNull();
  });

  it("rejects an unknown product_type", () => {
    expect(parseSubscriptionCustomId(`v1|unknown|${STUDENT_ID}|monthly`)).toBeNull();
  });

  it("rejects a non-uuid student_id", () => {
    expect(parseSubscriptionCustomId("v1|subscription|not-a-uuid|monthly")).toBeNull();
  });

  it("rejects an unknown plan_code when knownPlanCodes is supplied", () => {
    expect(
      parseSubscriptionCustomId(`v1|subscription|${STUDENT_ID}|monthly`, {
        knownPlanCodes: new Set(["annual"]),
      }),
    ).toBeNull();
  });

  it("rejects the wrong field count", () => {
    expect(parseSubscriptionCustomId(`v1|subscription|${STUDENT_ID}`)).toBeNull();
  });

  it("accepts any syntactically valid plan_code when knownPlanCodes is omitted", () => {
    expect(
      parseSubscriptionCustomId(`v1|subscription|${STUDENT_ID}|future-plan`),
    ).toEqual({
      productType: "subscription",
      studentId: STUDENT_ID,
      planCode: "future-plan",
      extra: null,
    });
  });

  it("rejects an inbound custom_id longer than 127 characters", () => {
    const overlong = `v1|subscription|${STUDENT_ID}|${"x".repeat(130)}`;
    expect(overlong.length).toBeGreaterThan(127);
    expect(parseSubscriptionCustomId(overlong)).toBeNull();
  });

  it("throws when a build field contains the '|' delimiter", () => {
    expect(() =>
      buildSubscriptionCustomId({
        productType: "subscription",
        studentId: STUDENT_ID,
        planCode: "mon|thly",
      }),
    ).toThrow("must not contain '|'");
  });

  it("round-trips an empty-string extra", () => {
    const customId = buildSubscriptionCustomId({
      productType: "subscription_upgrade",
      studentId: STUDENT_ID,
      planCode: "pro",
      extra: "",
    });

    expect(parseSubscriptionCustomId(customId)).toEqual({
      productType: "subscription_upgrade",
      studentId: STUDENT_ID,
      planCode: "pro",
      extra: "",
    });
  });
});
