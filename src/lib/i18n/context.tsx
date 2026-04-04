"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

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

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>("ar");

  const toggle = useCallback(() => {
    setLang((prev) => (prev === "ar" ? "en" : "ar"));
  }, []);

  const t = useCallback(
    (ar: string, en: string) => (lang === "ar" ? ar : en),
    [lang],
  );

  const dir = lang === "ar" ? "rtl" : "ltr";

  return (
    <LangContext.Provider value={{ lang, toggle, t, dir }}>
      {children}
    </LangContext.Provider>
  );
}

export function useLang() {
  return useContext(LangContext);
}
