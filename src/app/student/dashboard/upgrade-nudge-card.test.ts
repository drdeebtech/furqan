import { describe, it, expect } from "vitest";

import { shouldShowUpgradeNudge } from "./upgrade-nudge-card";

// Issue #546 — the nudge must render ONLY at exactly 1 remaining credit and
// only when the student hasn't dismissed it this session.
describe("shouldShowUpgradeNudge", () => {
  it("shows at exactly 1 credit when not dismissed", () => {
    expect(shouldShowUpgradeNudge(1, false)).toBe(true);
  });

  it("hides at 0 credits (no package left to nudge about)", () => {
    expect(shouldShowUpgradeNudge(0, false)).toBe(false);
  });

  it("hides at 2 credits (not yet at the threshold)", () => {
    expect(shouldShowUpgradeNudge(2, false)).toBe(false);
  });

  it("hides when dismissed even if 1 credit remains", () => {
    expect(shouldShowUpgradeNudge(1, true)).toBe(false);
  });
});
