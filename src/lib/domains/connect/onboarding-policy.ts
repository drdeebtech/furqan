// Spec 040 Phase 2 — the pure routing decision behind startConnectOnboarding
// (plan Phase 2 item 2). Kept out of the "use server" action so the policy is
// unit-testable; the action supplies the session-derived facts.
//
// Review-binding requirement (connect-accounts.ts header): only APPROVED
// teachers may reach Stripe onboarding — cv_status='approved' AND not
// archived — else any authenticated user could mint live Express accounts.
// Manual-rail teachers (FR-025/FR-026) see the "handled by the academy"
// state and NEVER receive a Connect link (a broken onboarding flow for them
// would be a dead end, plan Phase 2 item 2).

import type { PayoutMethod } from "./transfer-sweep";

export type OnboardingRoute =
  | "not_teacher" // no teacher_profiles row — nothing to onboard
  | "not_approved" // teacher exists but CV not approved / archived
  | "manual_rail" // FR-025: paid off-Stripe — show the manual state, no link
  | "stripe_onboarding"; // mint an Account Link

export interface OnboardingFacts {
  hasTeacherProfile: boolean;
  cvStatus: string | null;
  isArchived: boolean;
  payoutMethod: PayoutMethod | null;
}

export function decideOnboardingRoute(facts: OnboardingFacts): OnboardingRoute {
  if (!facts.hasTeacherProfile) return "not_teacher";
  if (facts.cvStatus !== "approved" || facts.isArchived) return "not_approved";
  if (facts.payoutMethod === "manual") return "manual_rail";
  return "stripe_onboarding";
}
