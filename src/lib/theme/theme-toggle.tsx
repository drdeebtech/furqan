"use client";

import { Sun, Moon } from "lucide-react";
import { useTheme } from "./context";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();

  return (
    <button
      onClick={toggle}
      className="glass glass-pill flex h-8 w-8 items-center justify-center !rounded-full !p-0 text-muted transition-colors hover:text-foreground"
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
    >
      {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
