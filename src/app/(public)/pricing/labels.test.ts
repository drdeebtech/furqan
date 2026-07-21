import { describe, it, expect } from "vitest";
import { sessionLabel, unitLabel } from "./content";
import { parseTrack, selectVisibleTracks } from "./track";

const t = (ar: string, _en: string) => ar;
const tEn = (_ar: string, en: string) => en;

const plan = (code: string, credits: number) => ({
  id: code,
  plan_code: code,
  name: code,
  monthly_credit_count: credits,
  price_cents: 1000,
});

describe("sessionLabel", () => {
  it("says hours for the individual track and sessions for group", () => {
    expect(sessionLabel(plan("hifz_individual_6h", 6), tEn)).toBe("6 hours / month");
    expect(sessionLabel(plan("hifz_group_6", 6), tEn)).toBe("6 sessions / month");
  });

  it("applies Arabic plural agreement on both tracks", () => {
    // The regression this guards: individual used to read "4 ساعة" (singular).
    expect(sessionLabel(plan("hifz_individual_4h", 4), t)).toBe("4 ساعات / شهر");
    expect(sessionLabel(plan("hifz_group_4", 4), t)).toBe("4 جلسات / شهر");
  });

  it("uses the singular in English for a single credit", () => {
    expect(sessionLabel(plan("hifz_individual_1h", 1), tEn)).toBe("1 hour / month");
    expect(sessionLabel(plan("hifz_group_1", 1), tEn)).toBe("1 session / month");
  });

  it("uses Arabic singular and dual for 1 and 2", () => {
    expect(sessionLabel(plan("hifz_individual_1h", 1), t)).toBe("1 ساعة / شهر");
    expect(sessionLabel(plan("hifz_individual_2h", 2), t)).toBe("2 ساعتان / شهر");
  });
});

describe("unitLabel", () => {
  it("prices individual plans per hour and group plans per session", () => {
    expect(unitLabel(plan("hifz_individual_8h", 8), tEn)).toBe("per hour");
    expect(unitLabel(plan("hifz_group_8", 8), tEn)).toBe("per session");
    expect(unitLabel(plan("hifz_individual_8h", 8), t)).toBe("للساعة");
    expect(unitLabel(plan("hifz_group_8", 8), t)).toBe("للحصة");
  });
});

/**
 * `?track=` is untrusted URL input read on the server. An unrecognised value
 * must fall back to showing everything — never an empty page, and never a
 * crash. Array form is possible because Next.js hands back string[] when a
 * param is repeated (`?track=a&track=b`).
 */
describe("parseTrack", () => {
  it("accepts only the two real tracks", () => {
    expect(parseTrack("group")).toBe("group");
    expect(parseTrack("private")).toBe("private");
  });

  it("falls back to null (show everything) for anything else", () => {
    for (const bad of ["", "GROUP", "Private", "bogus", "../etc/passwd", "<script>"]) {
      expect(parseTrack(bad)).toBeNull();
    }
  });

  it("handles a missing param", () => {
    expect(parseTrack(undefined)).toBeNull();
  });

  it("takes the first value when the param is repeated", () => {
    expect(parseTrack(["group", "private"])).toBe("group");
    expect(parseTrack(["bogus", "group"])).toBeNull();
    expect(parseTrack([])).toBeNull();
  });
});

/**
 * The redesign's central behaviour. Previously this was only ever verified by
 * grepping rendered HTML; asserting it directly means a refactor that silently
 * hides a track fails here instead of in production.
 */
describe("selectVisibleTracks", () => {
  const group = { key: "group" as const, plans: [1, 2, 3] };
  const priv = { key: "private" as const, plans: [1, 2, 3] };
  const empty = { key: "private" as const, plans: [] };

  it("shows BOTH tracks when no track is selected", () => {
    // Non-negotiable: a visitor who ignores the chooser, and any crawler, must
    // still see every plan.
    expect(selectVisibleTracks([group, priv], null)).toEqual([group, priv]);
  });

  it("narrows to exactly the selected track", () => {
    expect(selectVisibleTracks([group, priv], "private")).toEqual([priv]);
    expect(selectVisibleTracks([group, priv], "group")).toEqual([group]);
  });

  it("drops a track that has no plans, so no heading sits over nothing", () => {
    expect(selectVisibleTracks([group, empty], null)).toEqual([group]);
    expect(selectVisibleTracks([group, empty], "private")).toEqual([]);
  });

  it("returns empty rather than throwing when there are no tiers at all", () => {
    expect(selectVisibleTracks([], null)).toEqual([]);
    expect(selectVisibleTracks([], "group")).toEqual([]);
  });
});
