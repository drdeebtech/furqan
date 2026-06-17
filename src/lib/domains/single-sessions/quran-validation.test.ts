import { describe, it, expect } from "vitest";

import { validateTargetScope } from "./quran-validation";

/**
 * Spec 022 / T020 — Quran-structural validation for specialized sessions.
 *
 * Per AGENTS.md §2 (Quran integrity) and FR-015: any surah / ayah / juz
 * target on a specialized session MUST be validated against the canonical
 * reference (`src/lib/quran/ayah-counts.ts`). Invalid ranges are rejected,
 * NEVER auto-corrected. The independent test in spec US3 quickstart:
 *
 *   surah 999 → 422 before any Stripe call
 *   surah 36  → valid
 *
 * `validateTargetScope` is the route-boundary gate that runs BEFORE any DB
 * write or Stripe Checkout creation (fail-before-charge, R-004).
 */
describe("validateTargetScope (spec 022 / T020)", () => {
  // ── Happy paths ────────────────────────────────────────────────────────────
  it("accepts a valid surah (1..114)", () => {
    expect(validateTargetScope({ surah: 1 }).valid).toBe(true);
    expect(validateTargetScope({ surah: 36 }).valid).toBe(true);
    expect(validateTargetScope({ surah: 114 }).valid).toBe(true);
  });

  it("accepts a valid juz (1..30)", () => {
    expect(validateTargetScope({ juz: 1 }).valid).toBe(true);
    expect(validateTargetScope({ juz: 30 }).valid).toBe(true);
  });

  it("accepts surah + bounded ayah range", () => {
    // Surah 1 (Al-Fātiḥah) has 7 ayat.
    expect(validateTargetScope({ surah: 1, ayahStart: 1, ayahEnd: 7 }).valid).toBe(true);
    // Surah 36 (Yā-Sīn) has 83 ayat.
    expect(validateTargetScope({ surah: 36, ayahStart: 1, ayahEnd: 83 }).valid).toBe(true);
  });

  it("accepts free-text mutoon / mutashabihat descriptors", () => {
    expect(validateTargetScope({ mutoon: "Al-Jazariyyah" }).valid).toBe(true);
    expect(validateTargetScope({ mutashabihat: "Q21:34" }).valid).toBe(true);
  });

  // ── Quran-integrity rejections (the Quran-teacher lens) ────────────────────
  it("REJECTS surah 0, 115, 999, and non-integers (never auto-corrected)", () => {
    expect(validateTargetScope({ surah: 0 }).valid).toBe(false);
    expect(validateTargetScope({ surah: 115 }).valid).toBe(false);
    expect(validateTargetScope({ surah: 999 }).valid).toBe(false);
    expect(validateTargetScope({ surah: 36.5 }).valid).toBe(false);
    expect(validateTargetScope({ surah: "36" }).valid).toBe(false);
  });

  it("includes a client-surfaceable error message for invalid surah", () => {
    const r = validateTargetScope({ surah: 999 });
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/surah/i);
    expect(r.error).toContain("1–114");
  });

  it("REJECTS juz 0, 31, and non-integers", () => {
    expect(validateTargetScope({ juz: 0 }).valid).toBe(false);
    expect(validateTargetScope({ juz: 31 }).valid).toBe(false);
    expect(validateTargetScope({ juz: 30.5 }).valid).toBe(false);
  });

  it("REJECTS ayahEnd exceeding the surah's canonical ayah count", () => {
    // Surah 1 has 7 ayat — 8 is out of range.
    expect(validateTargetScope({ surah: 1, ayahEnd: 8 }).valid).toBe(false);
    // Surah 36 has 83 ayat — 84 is out of range.
    expect(validateTargetScope({ surah: 36, ayahEnd: 84 }).valid).toBe(false);
  });

  it("REJECTS ayahStart > ayahEnd", () => {
    const r = validateTargetScope({ surah: 36, ayahStart: 50, ayahEnd: 10 });
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/ayahStart/);
  });

  it("REJECTS ayahStart/ayahEnd without a surah", () => {
    const r = validateTargetScope({ ayahStart: 1, ayahEnd: 5 });
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/require a surah/);
  });

  // ── Shape + abuse guards ──────────────────────────────────────────────────
  it("REJECTS empty scope (at least one field required)", () => {
    const r = validateTargetScope({});
    expect(r.valid).toBe(false);
  });

  it("REJECTS non-object scope (array, null, primitive)", () => {
    expect(validateTargetScope(null).valid).toBe(false);
    expect(validateTargetScope(undefined).valid).toBe(false);
    expect(validateTargetScope("surah:36").valid).toBe(false);
    expect(validateTargetScope(36).valid).toBe(false);
    expect(validateTargetScope([36]).valid).toBe(false);
  });

  it("REJECTS over-length mutoon / mutashabihat descriptors (abuse guard)", () => {
    const long = "x".repeat(201);
    expect(validateTargetScope({ mutoon: long }).valid).toBe(false);
    expect(validateTargetScope({ mutashabihat: long }).valid).toBe(false);
  });

  it("REJECTS empty-string descriptors", () => {
    expect(validateTargetScope({ mutoon: "" }).valid).toBe(false);
    expect(validateTargetScope({ mutashabihat: "" }).valid).toBe(false);
  });
});
