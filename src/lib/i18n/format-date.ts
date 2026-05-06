import type { Lang } from "./server";

type Style = "short" | "long" | "time";

const STYLE_OPTIONS: Record<Style, Intl.DateTimeFormatOptions> = {
  short: { year: "numeric", month: "short", day: "numeric" },
  long: { weekday: "long", year: "numeric", month: "long", day: "numeric" },
  time: { hour: "2-digit", minute: "2-digit" },
};

const LOCALE: Record<Lang, string> = {
  ar: "ar",
  en: "en-US",
};

/**
 * Locale-aware date formatter — single source of truth for date strings
 * across server queries (dashboard-queries.ts) and client widgets.
 *
 * Replaces 4 hardcoded `toLocaleDateString("en-US"…)` / `("ar")` call-sites
 * the dashboard audit flagged as bleeding wrong-locale dates into Arabic
 * mode (admin dashboard-queries.ts:1437, moderator dashboard-queries.ts:1588,
 * teacher mentorship-card.tsx:79/:80/:120). One source — every dashboard
 * inherits the same locale rule.
 *
 * Server-safe — uses Intl, which is available in both Node and browser
 * runtimes. The `Lang` import is type-only so this file never pulls
 * `next/headers` into a client bundle.
 *
 * @param iso     ISO 8601 string, Date, or null/undefined (returns '').
 * @param lang    'ar' (Arabic locale, Arabic numerals + Gregorian months)
 *                or 'en' (en-US locale).
 * @param style   'short' (default — Mar 7, 2026 / ٧ مارس ٢٠٢٦),
 *                'long'  (Saturday, March 7, 2026 / السبت، ٧ مارس ٢٠٢٦),
 *                'time'  (HH:MM in the user's runtime timezone).
 */
export function formatDate(
  iso: string | Date | null | undefined,
  lang: Lang,
  style: Style = "short",
): string {
  if (iso === null || iso === undefined || iso === "") return "";
  const date = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(LOCALE[lang], STYLE_OPTIONS[style]).format(date);
}
