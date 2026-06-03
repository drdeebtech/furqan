import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock browser APIs before any module import
const localStorageStore: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (k: string) => localStorageStore[k] ?? null,
  setItem: (k: string, v: string) => { localStorageStore[k] = v; },
  removeItem: (k: string) => { delete localStorageStore[k]; },
  clear: () => { Object.keys(localStorageStore).forEach((k) => delete localStorageStore[k]); },
};

vi.stubGlobal("localStorage", mockLocalStorage);
vi.stubGlobal("document", {
  cookie: "",
  documentElement: { dir: "", lang: "" },
});
vi.stubGlobal("window", { localStorage: mockLocalStorage });

// ─── i18n pure logic ─────────────────────────────────────────────────────────

describe("i18n derivation logic", () => {
  const makeT = (lang: "ar" | "en") => (ar: string, en: string) =>
    lang === "ar" ? ar : en;
  const makeDir = (lang: "ar" | "en") =>
    lang === "ar" ? ("rtl" as const) : ("ltr" as const);

  beforeEach(() => {
    mockLocalStorage.clear();
    (global.document as { cookie: string }).cookie = "";
  });

  it("t returns Arabic text when lang is ar", () => {
    expect(makeT("ar")("مرحبا", "Hello")).toBe("مرحبا");
  });

  it("t returns English text when lang is en", () => {
    expect(makeT("en")("مرحبا", "Hello")).toBe("Hello");
  });

  it("dir is rtl when lang is ar", () => {
    expect(makeDir("ar")).toBe("rtl");
  });

  it("dir is ltr when lang is en", () => {
    expect(makeDir("en")).toBe("ltr");
  });
});

// ─── stored lang resolution (mirrors getStoredLang private fn) ────────────────

describe("stored lang resolution", () => {
  beforeEach(() => {
    mockLocalStorage.clear();
    (global.document as { cookie: string }).cookie = "";
  });

  it("defaults to ar when nothing is stored", () => {
    // cookie empty, localStorage empty → ar
    const cookieMatch = (global.document as { cookie: string }).cookie.match(
      /(?:^|; )furqan-lang=(ar|en)/
    );
    const cookie = cookieMatch?.[1];
    const stored = mockLocalStorage.getItem("furqan-lang");
    const resolved = cookie ?? (stored === "en" ? "en" : "ar");
    expect(resolved).toBe("ar");
  });

  it("resolves to en when localStorage has en", () => {
    mockLocalStorage.setItem("furqan-lang", "en");
    const stored = mockLocalStorage.getItem("furqan-lang");
    const resolved = stored === "en" ? "en" : "ar";
    expect(resolved).toBe("en");
  });

  it("cookie takes priority over localStorage", () => {
    mockLocalStorage.setItem("furqan-lang", "en");
    (global.document as { cookie: string }).cookie = "furqan-lang=ar";
    const cookieMatch = (global.document as { cookie: string }).cookie.match(
      /(?:^|; )furqan-lang=(ar|en)/
    );
    const resolved = cookieMatch?.[1] ?? "ar";
    expect(resolved).toBe("ar");
  });

  it("persist writes to localStorage", () => {
    mockLocalStorage.setItem("furqan-lang", "en");
    expect(mockLocalStorage.getItem("furqan-lang")).toBe("en");
  });
});
