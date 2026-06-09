"use client";

/**
 * <SearchInput /> — URL-driven, debounced text search for listing pages.
 *
 * Pattern follows Next.js Learn (App Router) conventions:
 *   - The current value is read from URL searchParams (server-rendered).
 *   - Typing replaces the URL via router.replace (no history spam).
 *   - The Server Component re-renders with the new ?q=... and re-queries.
 *
 * Usage:
 *   // page.tsx (Server Component)
 *   const { q = "" } = await searchParams;
 *   const { data } = await supabase.from("profiles")
 *     .select("...")
 *     .ilike("full_name", `%${q}%`);
 *   return <SearchInput placeholder="..." paramName="q" />;
 */
import { Suspense, useEffect, useState, startTransition, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { useLang } from "@/lib/i18n/context";

interface Props {
  placeholder?: string;
  paramName?: string;
  ariaLabel?: string;
  /** Debounce in ms. 250 keeps search snappy without spamming the server. */
  debounceMs?: number;
}

export function SearchInput(props: Props) {
  return (
    <Suspense fallback={null}>
      <SearchInputInner {...props} />
    </Suspense>
  );
}

function SearchInputInner({
  placeholder,
  paramName = "q",
  ariaLabel,
  debounceMs = 250,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { lang } = useLang();
  const t = (ar: string, en: string) => (lang === "ar" ? ar : en);
  const resolvedPlaceholder = placeholder ?? t("بحث...", "Search...");
  const resolvedAriaLabel = ariaLabel ?? t("بحث", "Search");
  const [value, setValue] = useState(() => searchParams.get(paramName) ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  // When the URL changes externally (e.g. browser back), keep the input synced.
  // startTransition keeps this off the synchronous render path — required by
  // React 19 compiler / project lint rule (see CLAUDE.md). Guard prevents the
  // self-triggered re-run after our own router.replace below.
  useEffect(() => {
    const next = searchParams.get(paramName) ?? "";
    startTransition(() => {
      setValue((prev) => (prev === next ? prev : next));
    });
  }, [searchParams, paramName]);

  // Debounced URL replacement.
  useEffect(() => {
    const current = searchParams.get(paramName) ?? "";
    if (value === current) return;
    const id = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(paramName, value);
      } else {
        params.delete(paramName);
      }
      // Reset pagination when query changes.
      params.delete("page");
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }, debounceMs);
    return () => clearTimeout(id);
  }, [value, paramName, debounceMs, pathname, router, searchParams]);

  return (
    <div className="relative w-full max-w-sm">
      <Search
        size={16}
        aria-hidden="true"
        className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted"
      />
      <input
        ref={inputRef}
        type="search"
        inputMode="search"
        aria-label={resolvedAriaLabel}
        placeholder={resolvedPlaceholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="glass-input focus-ring w-full rounded-xl py-2 pe-10 ps-10 text-sm text-foreground placeholder:text-muted/50"
      />
      {value && (
        <button
          type="button"
          onClick={() => {
            setValue("");
            inputRef.current?.focus();
          }}
          aria-label={t("مسح البحث", "Clear search")}
          className="focus-ring absolute end-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
        >
          <X size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
