"use client";

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";

export type Lang = "ar" | "en";

interface LangContextType {
  lang: Lang;
  toggle: () => void;
  t: (ar: string, en: string) => string;
  dir: "rtl" | "ltr";
}

const LangContext = createContext<LangContextType>({
  lang: "ar",
  toggle: () => {},
  t: (ar) => ar,
  dir: "rtl",
});

function hasStoredLang(): boolean {
  if (typeof window === "undefined") return false;
  return /(?:^|; )furqan-lang=(ar|en)/.test(document.cookie) ||
    localStorage.getItem("furqan-lang") === "ar" ||
    localStorage.getItem("furqan-lang") === "en";
}

function getStoredLang(): Lang {
  if (typeof window === "undefined") return "ar";
  // Prefer cookie (visible to the server) over localStorage (client-only).
  const cookieMatch = document.cookie.match(/(?:^|; )furqan-lang=(ar|en)/);
  if (cookieMatch) return cookieMatch[1] as Lang;
  const stored = localStorage.getItem("furqan-lang");
  if (stored === "en" || stored === "ar") return stored;
  // spec 035 US5 (FR-010): first visit, no stored choice — honor the browser's
  // language. Arabic stays the canonical default; only a clearly non-Arabic top
  // preference flips to English. Permitted by constitution v1.3.0. The explicit
  // toggle always overrides and persists (persistLang).
  const nav = (navigator.languages?.[0] ?? navigator.language ?? "").toLowerCase();
  const primary = nav.split("-")[0];
  return primary && primary !== "ar" ? "en" : "ar";
}

function persistLang(next: Lang) {
  if (typeof window === "undefined") return;
  localStorage.setItem("furqan-lang", next);
  // Cookie lets the server component (root layout) render <html lang="..."> correctly.
  // 1 year, Lax so cross-site links preserve the choice but CSRF-like flows don't.
  document.cookie = `furqan-lang=${next}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(() => {
    if (typeof window !== "undefined") return getStoredLang();
    return "ar";
  });
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // spec 035 US5: on first visit (no stored choice) persist the detected
    // language so the server renders it on the next navigation (sets the
    // furqan-lang cookie) — making return visits flash-free and SSR-consistent.
    if (!hasStoredLang()) persistLang(lang);
    queueMicrotask(() => setMounted(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!mounted) return;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    document.documentElement.lang = lang;
  }, [lang, mounted]);

  const toggle = useCallback(() => {
    setLang((prev) => {
      const next = prev === "ar" ? "en" : "ar";
      persistLang(next);
      return next;
    });
  }, []);

  const t = useCallback(
    (ar: string, en: string) => (lang === "ar" ? ar : en),
    [lang],
  );

  const dir = lang === "ar" ? "rtl" : "ltr";

  // Prevent flash of wrong language
  if (!mounted) {
    return (
      <LangContext.Provider value={{ lang: "ar", toggle, t: (ar) => ar, dir: "rtl" }}>
        {children}
      </LangContext.Provider>
    );
  }

  return (
    <LangContext.Provider value={{ lang, toggle, t, dir }}>
      {children}
    </LangContext.Provider>
  );
}

export function useLang() {
  return useContext(LangContext);
}
