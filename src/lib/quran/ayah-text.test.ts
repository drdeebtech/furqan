import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { VERIFIED_AYAT, QURAN_QUOTES, getVerifiedAyah } from "./ayah-text";

// The verified ayah-text module is the single source for rendered Quran text
// (CLAUDE.md §2). These tests are the executable guarantee behind that claim:
// every displayed quote is a byte-exact slice of a verified full ayah, the
// stored text is genuinely Uthmani (not simplified), and NO page hardcodes an
// ayah bracket — so scripture can never drift back inline.

const ORNAMENT_OPEN = "﴿"; // ﴿ ORNATE LEFT PARENTHESIS
const ORNAMENT_CLOSE = "﴾"; // ﴾ ORNATE RIGHT PARENTHESIS
// Uthmani-only marks absent from simplified/Imlaei script.
const UTHMANI_MARKERS = ["ٱ" /* ٱ wasla */, "ٰ" /* ٰ dagger alef */, "ۥ" /* ۥ small waw */];

describe("verified ayah-text module", () => {
  it("every quote is a byte-exact substring of its verified full ayah", () => {
    for (const [name, q] of Object.entries(QURAN_QUOTES)) {
      const full = VERIFIED_AYAT[q.verseKey];
      expect(full, `${name}: unknown verseKey ${q.verseKey}`).toBeTruthy();
      expect(
        full.includes(q.text),
        `${name}: displayed text is NOT a byte-exact substring of verified ${q.verseKey}`,
      ).toBe(true);
    }
  });

  it("every verified ayah carries Uthmani orthography (not simplified script)", () => {
    for (const [key, text] of Object.entries(VERIFIED_AYAT)) {
      const hasMarker = UTHMANI_MARKERS.some((m) => text.includes(m));
      expect(hasMarker, `${key}: no Uthmani marker (wasla/dagger-alef/small-waw) — looks simplified`).toBe(true);
    }
  });

  it("stored text holds no ornamental brackets (those belong to AyahQuote)", () => {
    for (const [key, text] of Object.entries(VERIFIED_AYAT)) {
      expect(text.includes(ORNAMENT_OPEN) || text.includes(ORNAMENT_CLOSE), `${key} must not embed ﴿ ﴾`).toBe(false);
    }
    for (const [name, q] of Object.entries(QURAN_QUOTES)) {
      expect(q.text.includes(ORNAMENT_OPEN) || q.text.includes(ORNAMENT_CLOSE), `${name} must not embed ﴿ ﴾`).toBe(false);
    }
  });

  it("getVerifiedAyah returns the stored text and throws on an unknown key", () => {
    expect(getVerifiedAyah("15:9")).toBe(VERIFIED_AYAT["15:9"]);
    // @ts-expect-error — an unknown key is a compile-time AND runtime error.
    expect(() => getVerifiedAyah("1:1")).toThrow();
  });

  it("no page hardcodes an ayah bracket — all rendering routes through AyahQuote", () => {
    const roots = ["src/app", "src/components"];
    const allowed = "src/components/quran/ayah-quote.tsx";
    const offenders: string[] = [];
    for (const root of roots) {
      for (const rel of readdirSync(root, { recursive: true }) as string[]) {
        if (!/\.(tsx?|jsx?)$/.test(rel)) continue;
        const path = join(root, rel).replace(/\\/g, "/");
        if (path === allowed) continue;
        if (readFileSync(path, "utf8").includes(ORNAMENT_OPEN)) offenders.push(path);
      }
    }
    expect(
      offenders,
      `these files hardcode a Quran bracket instead of using <AyahQuote>: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});
