"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { useLang } from "@/lib/i18n/context";

// ponytail: inline debounce — no utility needed for a single usage
function useDebounce(value: string, delay: number): string {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return v;
}

interface Props {
  initialValue: string;
  onDebouncedChange: (value: string) => void;
}

export function TeacherSearchInput({ initialValue, onDebouncedChange }: Props) {
  const { t } = useLang();
  const [raw, setRaw] = useState(initialValue);
  const debounced = useDebounce(raw, 300);

  useEffect(() => {
    onDebouncedChange(debounced);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  return (
    <div className="relative" role="search">
      <Search
        size={16}
        className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted"
        aria-hidden="true"
      />
      <input
        type="search"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        placeholder={t(
          "ابحث عن معلم بالاسم أو التخصص…",
          "Search by name or specialty…",
        )}
        aria-label={t("البحث عن معلم", "Search teachers")}
        className="w-full rounded-lg border border-white/10 bg-card/50 py-2.5 pe-4 ps-9 text-sm text-foreground placeholder:text-muted focus:border-gold/40 focus:outline-none focus:ring-1 focus:ring-gold/40"
        dir="auto"
        minLength={2}
      />
    </div>
  );
}
