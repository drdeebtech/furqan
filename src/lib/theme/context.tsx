"use client";

import { createContext, useContext, useState, useCallback, useEffect, useSyncExternalStore, type ReactNode } from "react";

export type Theme = "dark" | "light";

interface ThemeContextType {
  theme: Theme;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: "dark",
  toggle: () => {},
});

function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  const stored = localStorage.getItem("furqan-theme");
  return stored === "light" ? "light" : "dark";
}

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  if (theme === "light") {
    el.classList.add("light");
  } else {
    el.classList.remove("light");
  }
}

const emptySubscribe = () => () => {};

export function ThemeProvider({ children }: { children: ReactNode }) {
  const isClient = useSyncExternalStore(emptySubscribe, () => true, () => false);

  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    if (!isClient) return;
    const stored = getStoredTheme();
    // Sync theme from localStorage on hydration — intentional
    setTheme(stored); // eslint-disable-line react-hooks/set-state-in-effect
    applyTheme(stored);
  }, [isClient]);

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      localStorage.setItem("furqan-theme", next);
      applyTheme(next);
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ theme: isClient ? theme : "dark", toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
