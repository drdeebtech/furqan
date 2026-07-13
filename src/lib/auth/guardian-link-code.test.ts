import { describe, it, expect } from "vitest";
import { guardianCodeMatches, normalizeGuardianCode } from "./guardian-link-code";

describe("guardianCodeMatches (AUTHZ-VULN-01)", () => {
  it("matches the correct code case-insensitively and trimmed", () => {
    expect(guardianCodeMatches("AB12CD34EF", "AB12CD34EF")).toBe(true);
    expect(guardianCodeMatches("AB12CD34EF", "ab12cd34ef")).toBe(true);
    expect(guardianCodeMatches("AB12CD34EF", "  AB12CD34EF  ")).toBe(true);
  });

  it("rejects a wrong code", () => {
    expect(guardianCodeMatches("AB12CD34EF", "AB12CD34EG")).toBe(false);
    expect(guardianCodeMatches("AB12CD34EF", "ZZZZZZZZZZ")).toBe(false);
  });

  it("fails closed on a null/undefined/empty stored code", () => {
    // A student who never generated a code must not be linkable.
    expect(guardianCodeMatches(null, "AB12CD34EF")).toBe(false);
    expect(guardianCodeMatches(undefined, "AB12CD34EF")).toBe(false);
    expect(guardianCodeMatches("", "AB12CD34EF")).toBe(false);
  });

  it("rejects an empty/whitespace submitted code even if stored is empty-ish", () => {
    expect(guardianCodeMatches("AB12CD34EF", "")).toBe(false);
    expect(guardianCodeMatches("AB12CD34EF", "   ")).toBe(false);
  });

  it("normalizeGuardianCode trims and uppercases", () => {
    expect(normalizeGuardianCode("  ab12  ")).toBe("AB12");
  });
});
