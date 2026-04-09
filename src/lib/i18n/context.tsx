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
  const stored = localStorage.getItem("furqan-lang");
  return stored === "en" ? "en" : "ar";
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
      localStorage.setItem("furqan-lang", next);
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
