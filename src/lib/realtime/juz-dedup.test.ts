import { describe, it, expect, beforeEach, vi } from "vitest";
import { isJuzCelebrated, markJuzCelebrated, extractJuzNumber } from "./juz-dedup";

// ── sessionStorage mock (tests run in node environment) ──────────────────────

const storage = new Map<string, string>();
const sessionStorageMock: Storage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value); },
  removeItem: (key: string) => { storage.delete(key); },
  clear: () => storage.clear(),
  key: (i: number) => [...storage.keys()][i] ?? null,
  get length() { return storage.size; },
};

vi.stubGlobal("sessionStorage", sessionStorageMock);

beforeEach(() => storage.clear());

// ── isJuzCelebrated / markJuzCelebrated ──────────────────────────────────────

describe("isJuzCelebrated", () => {
  it("returns false for a juz not yet marked", () => {
    expect(isJuzCelebrated(5)).toBe(false);
  });

  it("returns true after markJuzCelebrated is called", () => {
    markJuzCelebrated(5);
    expect(isJuzCelebrated(5)).toBe(true);
  });

  it("is isolated per juz number", () => {
    markJuzCelebrated(3);
    expect(isJuzCelebrated(3)).toBe(true);
    expect(isJuzCelebrated(4)).toBe(false);
  });

  it("does not bleed between juz 1 and juz 10 (no key prefix collision)", () => {
    markJuzCelebrated(1);
    expect(isJuzCelebrated(10)).toBe(false);
  });
});

describe("markJuzCelebrated", () => {
  it("is idempotent — second call does not throw", () => {
    expect(() => {
      markJuzCelebrated(7);
      markJuzCelebrated(7);
    }).not.toThrow();
  });
});

// ── extractJuzNumber ─────────────────────────────────────────────────────────

describe("extractJuzNumber", () => {
  it("returns null for null data", () => {
    expect(extractJuzNumber(null)).toBeNull();
  });

  it("returns null for non-object data", () => {
    expect(extractJuzNumber("string")).toBeNull();
    expect(extractJuzNumber(42)).toBeNull();
    expect(extractJuzNumber([])).toBeNull();
  });

  it("returns null when juz key is absent", () => {
    expect(extractJuzNumber({ other: "value" })).toBeNull();
  });

  it("returns null when juz is non-numeric", () => {
    expect(extractJuzNumber({ juz: "five" })).toBeNull();
  });

  it("returns null when juz is out of range (0 or 31)", () => {
    expect(extractJuzNumber({ juz: 0 })).toBeNull();
    expect(extractJuzNumber({ juz: 31 })).toBeNull();
  });

  it("returns null when juz is a float", () => {
    expect(extractJuzNumber({ juz: 5.5 })).toBeNull();
  });

  it("returns the juz number for valid in-range integers (1–30)", () => {
    expect(extractJuzNumber({ juz: 1 })).toBe(1);
    expect(extractJuzNumber({ juz: 15 })).toBe(15);
    expect(extractJuzNumber({ juz: 30 })).toBe(30);
  });
});
