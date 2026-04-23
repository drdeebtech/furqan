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

function getStoredLang(): Lang {
  if (typeof window === "undefined") return "ar";
  // Prefer cookie (visible to the server) over localStorage (client-only).
  const cookieMatch = document.cookie.match(/(?:^|; )furqan-lang=(ar|en)/);
  if (cookieMatch) return cookieMatch[1] as Lang;
  const stored = localStorage.getItem("furqan-lang");
  return stored === "en" ? "en" : "ar";
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
    queueMicrotask(() => setMounted(true));
  }, []);

  useEffect(() => {
    if (!mounted) return;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
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
