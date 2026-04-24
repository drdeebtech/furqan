import { cookies } from "next/headers";

export type Lang = "ar" | "en";

/**
 * Server-side language resolution. Reads the `furqan-lang` cookie the
 * LangProvider writes on the client, falling back to 'ar' when missing.
 *
 * Usage in a server component:
 *   const { t, lang, dir } = await getT();
 *   <h1>{t("إدارة الحجوزات", "Manage Bookings")}</h1>
 *
 * For client components, keep using useLang() from @/lib/i18n/context —
 * this file is server-only (never import into 'use client' files).
 */
export async function getT(): Promise<{
  t: (ar: string, en: string) => string;
  lang: Lang;
  dir: "rtl" | "ltr";
}> {
  const cookieStore = await cookies();
  const stored = cookieStore.get("furqan-lang")?.value;
  const lang: Lang = stored === "en" ? "en" : "ar";
  return {
    lang,
    dir: lang === "ar" ? "rtl" : "ltr",
    t: (ar, en) => (lang === "ar" ? ar : en),
  };
}
