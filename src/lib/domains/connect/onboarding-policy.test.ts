import { describe, expect, it } from "vitest";
import { decideOnboardingRoute, type OnboardingFacts } from "./onboarding-policy";

function facts(overrides: Partial<OnboardingFacts> = {}): OnboardingFacts {
  return {
    hasTeacherProfile: true,
    cvStatus: "approved",
    isArchived: false,
    payoutMethod: "stripe_connect",
    ...overrides,
  };
}

describe("decideOnboardingRoute (Phase 2 gate — review-binding requirements)", () => {
  it("an approved Stripe-rail teacher gets Stripe onboarding", () => {
    expect(decideOnboardingRoute(facts())).toBe("stripe_onboarding");
  });

  it("no teacher profile → not_teacher (a student can never mint an Express account)", () => {
    expect(decideOnboardingRoute(facts({ hasTeacherProfile: false }))).toBe("not_teacher");
  });

  it("unapproved CV → not_approved", () => {
    for (const cvStatus of ["draft", "pending_review", "rejected", null]) {
      expect(decideOnboardingRoute(facts({ cvStatus }))).toBe("not_approved");
    }
  });

  it("archived teacher → not_approved even with an approved CV", () => {
    expect(decideOnboardingRoute(facts({ isArchived: true }))).toBe("not_approved");
  });

  it("manual-rail teacher → manual_rail, never a Connect link (FR-025/026)", () => {
    expect(decideOnboardingRoute(facts({ payoutMethod: "manual" }))).toBe("manual_rail");
  });

  it("approval is checked before the rail — an unapproved manual teacher is not_approved", () => {
    expect(
      decideOnboardingRoute(facts({ cvStatus: "pending_review", payoutMethod: "manual" })),
    ).toBe("not_approved");
  });
});
