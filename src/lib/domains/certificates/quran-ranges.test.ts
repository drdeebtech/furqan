import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getLevelBoundaries } from "./quran-ranges";

describe("getLevelBoundaries", () => {
  it("single surah 1 → 1:1 to 1:7 (Al-Fatiha)", () => {
    const r = getLevelBoundaries("1");
    expect(r).toEqual({ start: "1:1", end: "1:7" });
  });

  it("single surah 2 → 1 to 286 (Al-Baqarah)", () => {
    const r = getLevelBoundaries("2");
    expect(r).toEqual({ start: "2:1", end: "2:286" });
  });

  it("single surah 114 → last surah (An-Nas)", () => {
    const r = getLevelBoundaries("114");
    expect(r).toEqual({ start: "114:1", end: "114:6" });
  });

  it("range 112-114 → start 112:1, end 114:6", () => {
    const r = getLevelBoundaries("112-114");
    expect(r).toEqual({ start: "112:1", end: "114:6" });
  });

  it("range 78-80 → start 78:1, end 80:42", () => {
    const r = getLevelBoundaries("78-80");
    expect(r).toEqual({ start: "78:1", end: "80:42" });
  });

  it("throws on surah 0 (below range)", () => {
    expect(() => getLevelBoundaries("0")).toThrow();
  });

  it("throws on surah 115 (above range)", () => {
    expect(() => getLevelBoundaries("115")).toThrow();
  });

  it("throws on reversed range '5-1'", () => {
    expect(() => getLevelBoundaries("5-1")).toThrow(/reversed range/);
  });

  it("throws on non-integer milestone key 'foo'", () => {
    expect(() => getLevelBoundaries("foo")).toThrow();
  });

  it("throws on float '1.5'", () => {
    expect(() => getLevelBoundaries("1.5")).toThrow();
  });

  it("throws on empty string", () => {
    expect(() => getLevelBoundaries("")).toThrow();
  });
});
