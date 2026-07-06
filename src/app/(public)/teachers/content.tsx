"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Award, GraduationCap, Star } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { paginationIcons } from "@/lib/i18n/pagination-direction";
import { logError } from "@/lib/logger";
import { useFeatureFlags } from "@/lib/feature-flags-context";
import { Testimonials } from "@/components/public/testimonials";
import { RegisterBanner } from "@/components/public/register-banner";
import { TeacherSearchInput } from "@/components/public/teacher-search-input";
import { TeacherFilterBar, type FilterState } from "@/components/public/teacher-filter-bar";
import { TeacherGridSkeleton } from "@/components/public/teacher-card-skeleton";
import type { TeacherCard as TeacherCardData, TeacherSearchResult } from "@/lib/supabase/teacher-search";
import { TeacherCard } from "./teacher-card";

type LabelMap = Record<string, { ar: string; en: string }>;

const PAGE_LIMIT = 12;

export function TeachersContent({
  initialTeachers,
  specialtyLabels,
  recitationLabels,
}: {
  initialTeachers: TeacherCardData[];
  specialtyLabels: LabelMap;
  recitationLabels: LabelMap;
}) {
  const { t, lang } = useLang();
  const { hidePrices } = useFeatureFlags();
  const router = useRouter();
  const searchParams = useSearchParams();

  // fetchedFor tracks which searchParams string was last resolved (enables derived isLoading)
  const [fetchedFor, setFetchedFor] = useState("");
  const [apiResult, setApiResult] = useState<{ teachers: TeacherCardData[]; total: number } | null>(null);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [retryTick, setRetryTick] = useState(0); // bumped by the error-state Retry button to re-run the fetch effect

  // Derived display values — no synchronous setState in the effect at all
  const q = searchParams.get("q") ?? "";
  const currentPage = Number(searchParams.get("page") ?? "1");
  const hasFilters = Boolean(
    q || searchParams.get("language") || searchParams.get("gender") ||
    searchParams.get("specialty") || searchParams.get("price_min") ||
    searchParams.get("price_max") || currentPage > 1,
  );
  const searchKey = searchParams.toString();
  const isLoading = hasFilters && fetchedFor !== searchKey;
  const teachers = hasFilters ? (apiResult?.teachers ?? []) : initialTeachers;
  const total = hasFilters ? (apiResult?.total ?? 0) : initialTeachers.length;
  const totalPages = Math.ceil(total / PAGE_LIMIT);

  useEffect(() => {
    if (!hasFilters) return; // derived state handles no-filter display — no setState needed
    const params = new URLSearchParams();
    const ql = searchParams.get("q") ?? "";
    const language = searchParams.get("language") ?? "";
    const gender = searchParams.get("gender") ?? "";
    const specialty = searchParams.get("specialty") ?? "";
    const priceMin = searchParams.get("price_min") ?? "";
    const priceMax = searchParams.get("price_max") ?? "";
    const page = Number(searchParams.get("page") ?? "1");
    if (ql) params.set("q", ql);
    if (language) params.set("language", language);
    if (gender) params.set("gender", gender);
    if (specialty) params.set("specialty", specialty);
    if (priceMin) params.set("price_min", priceMin);
    if (priceMax) params.set("price_max", priceMax);
    params.set("page", String(page));
    params.set("limit", String(PAGE_LIMIT));
    const key = searchKey; // capture for closure
    const controller = new AbortController();
    fetch(`/api/teachers/search?${params.toString()}`, { signal: controller.signal })
      .then((r) => {
        // A 4xx/5xx body ({ error: … }) must not be parsed as a result set —
        // that would render a false "no teachers match" empty state.
        if (!r.ok) throw new Error(`Search request failed: ${r.status}`);
        return r.json();
      })
      .then((data: TeacherSearchResult) => {
        setApiResult({ teachers: data.teachers ?? [], total: data.total ?? 0 });
        setFetchFailed(false);
        setFetchedFor(key); // async — not flagged by set-state-in-effect
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return; // dep change — expected
        logError("teacher search fetch failed", err, { route: "/teachers", widget: "teacher-search" });
        setFetchFailed(true);
        setFetchedFor(key); // resolve isLoading so the skeleton can't spin forever
      });
    return () => controller.abort();
  }, [searchParams, hasFilters, searchKey, retryTick]);

  function setParam(key: string, value: string) {
    // No-op when the value is already in the URL — the search input emits its
    // initial value on mount, and without this guard that emission would
    // delete `page` and rewrite /teachers?q=foo&page=3 back to page 1.
    if ((searchParams.get(key) ?? "") === value) return;
    const p = new URLSearchParams(searchParams.toString());
    if (value) { p.set(key, value); } else { p.delete(key); }
    p.delete("page");
    router.replace(`/teachers?${p.toString()}`, { scroll: false });
  }

  function clearFilters() {
    router.replace("/teachers", { scroll: false });
  }

  function setPage(next: number) {
    const p = new URLSearchParams(searchParams.toString());
    if (next > 1) { p.set("page", String(next)); } else { p.delete("page"); }
    router.replace(`/teachers?${p.toString()}`, { scroll: false });
  }

  const filters: FilterState = {
    language: searchParams.get("language") ?? "",
    gender: searchParams.get("gender") ?? "",
    specialty: searchParams.get("specialty") ?? "",
    priceMin: searchParams.get("price_min") ?? "",
    priceMax: searchParams.get("price_max") ?? "",
  };

  // Pagination arrows follow reading direction: in Arabic RTL "previous" points
  // right, in English LTR it points left (Bilingual-First rule). Label/aria stay
  // per-language; only the glyph swaps.
  const { PrevIcon, NextIcon } = paginationIcons(lang);

  return (
    <div>
      <section className="islamic-pattern relative overflow-hidden pt-24 pb-16 text-center">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-background/40 via-transparent to-background" aria-hidden="true" />
        <div className="relative mx-auto max-w-3xl px-6">
          <nav aria-label={t("مسار الصفحة", "Breadcrumb")} className="text-xs text-muted-light">
            <Link href="/" className="text-gold transition-colors hover:text-gold-light focus-ring">{t("الرئيسية", "Home")}</Link>
            <span className="mx-2 text-muted-light" aria-hidden="true">/</span>
            <span className="text-muted">{t("المعلمون", "Teachers")}</span>
          </nav>
          <h1 className="font-display mt-4 text-4xl font-bold leading-tight sm:text-5xl">{t("معلمونا", "Our Teachers")}</h1>
          <p className="mt-3 text-sm text-muted">
            {isLoading
              ? t("جارٍ البحث…", "Searching…")
              : hasFilters
                ? t(`${total} نتيجة`, `${total} results`)
                : t(`${total} معلم معتمد`, `${total} certified teachers`)}
          </p>
        </div>
      </section>

      <section className="border-b border-white/10 py-8">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-center gap-8 px-6">
          {[
            { icon: Award, ar: "إجازات مُدقَّقة", en: "Verified Ijazah credentials" },
            { icon: GraduationCap, ar: "منهم خريجو الأزهر", en: "Including Al-Azhar graduates" },
            { icon: Star, ar: "جلسات فيديو مباشرة", en: "Live Video Sessions" },
          ].map((b) => (
            <div key={b.en} className="flex items-center gap-2 text-sm text-muted">
              <b.icon size={18} className="text-gold" />
              {t(b.ar, b.en)}
            </div>
          ))}
        </div>
      </section>

      <section className="py-12">
        <div className="mx-auto max-w-7xl px-6">
          <TeacherSearchInput
            initialValue={q}
            onDebouncedChange={(val) => setParam("q", val)}
          />

          <div className="mt-6 flex gap-8">
            <TeacherFilterBar
              filters={filters}
              specialtyLabels={specialtyLabels}
              onChange={(key, val) => {
                const urlKey = key === "priceMin" ? "price_min" : key === "priceMax" ? "price_max" : key;
                setParam(urlKey, val);
              }}
              onClear={clearFilters}
            />

            <div
              className="min-w-0 flex-1"
              aria-live="polite"
              aria-busy={isLoading}
              aria-label={t("نتائج المعلمين", "Teacher results")}
            >
              {isLoading ? (
                <TeacherGridSkeleton />
              ) : fetchFailed && hasFilters ? (
                <div className="glass-card p-12 text-center" role="alert">
                  <GraduationCap size={32} className="mx-auto mb-3 text-muted" />
                  <p className="text-muted">{t("تعذّر البحث مؤقتًا. حاول مرة أخرى.", "Search is temporarily unavailable. Please try again.")}</p>
                  <button
                    type="button"
                    onClick={() => { setFetchedFor(""); setRetryTick((n) => n + 1); }}
                    className="min-h-11 mt-3 text-sm text-gold underline underline-offset-2"
                  >
                    {t("إعادة المحاولة", "Retry")}
                  </button>
                </div>
              ) : teachers.length === 0 ? (
                <div className="glass-card p-12 text-center">
                  <GraduationCap size={32} className="mx-auto mb-3 text-muted" />
                  {hasFilters ? (
                    <>
                      <p className="text-muted">{t("لا توجد نتائج لهذا البحث.", "No teachers match these filters.")}</p>
                      <button
                        type="button"
                        onClick={clearFilters}
                        className="mt-3 text-sm text-gold underline underline-offset-2"
                      >
                        {t("مسح التصفية", "Clear filters")}
                      </button>
                    </>
                  ) : (
                    <>
                      <p className="text-muted">{t("نعمل على إضافة معلمين جدد — ترقبوا!", "We're adding new teachers — stay tuned!")}</p>
                      <p className="mt-2 text-sm text-muted">
                        {t("هل أنت معلم قرآن؟", "Are you a Quran teacher?")}{" "}
                        <Link href="/contact?type=teacher" className="text-gold underline underline-offset-2">
                          {t("تقدم للانضمام", "Apply to join")}
                        </Link>
                      </p>
                    </>
                  )}
                </div>
              ) : (
                <>
                  {(() => {
                    // Featured-tier grid (spec 037 Feature 2). The RPC already
                    // sorts by total_sessions DESC, so "featured" = first N items
                    // = the most-experienced teachers. Only promoted on page 1
                    // with healthy supply; pages 2+ and thin supply (≤3) render
                    // the uniform default grid (today's look).
                    const featuredCount = currentPage === 1
                      ? (teachers.length >= 6 ? 3 : teachers.length >= 4 ? 1 : 0)
                      : 0;
                    const featured = teachers.slice(0, featuredCount);
                    const rest = teachers.slice(featuredCount);

                    if (featuredCount > 0) {
                      return (
                        <>
                          <h2 className="font-display mb-6 text-2xl font-bold sm:text-3xl">
                            {t("المعلمون البارزون", "Featured teachers")}
                          </h2>
                          <ul className="grid list-none gap-6 p-0 lg:grid-cols-3" aria-label={t("المعلمون البارزون", "Featured teachers")}>
                            {featured.map((teacher) => (
                              <li
                                key={teacher.id}
                                className={featuredCount === 1 ? "lg:col-span-2" : ""}
                              >
                                <TeacherCard
                                  teacher={teacher}
                                  variant="featured"
                                  specialtyLabels={specialtyLabels}
                                  recitationLabels={recitationLabels}
                                  t={t}
                                  lang={lang}
                                  hidePrices={hidePrices}
                                />
                              </li>
                            ))}
                          </ul>

                          {rest.length > 0 && (
                            <>
                              <h2 className="font-display mb-4 mt-12 text-2xl font-bold sm:text-3xl">
                                {t("كل المعلمين", "All teachers")}
                              </h2>
                              <ul
                                className="grid list-none gap-4 p-0 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                                aria-label={t("كل المعلمين", "All teachers")}
                              >
                                {rest.map((teacher) => (
                                  <li key={teacher.id}>
                                    <TeacherCard
                                      teacher={teacher}
                                      variant="compact"
                                      specialtyLabels={specialtyLabels}
                                      recitationLabels={recitationLabels}
                                      t={t}
                                      lang={lang}
                                      hidePrices={hidePrices}
                                    />
                                  </li>
                                ))}
                              </ul>
                            </>
                          )}
                        </>
                      );
                    }

                    return (
                      <ul
                        className="grid list-none gap-6 p-0 md:grid-cols-2 lg:grid-cols-3"
                        aria-label={t("كل المعلمين", "All teachers")}
                      >
                        {teachers.map((teacher) => (
                          <li key={teacher.id}>
                            <TeacherCard
                              teacher={teacher}
                              variant="default"
                              specialtyLabels={specialtyLabels}
                              recitationLabels={recitationLabels}
                              t={t}
                              lang={lang}
                              hidePrices={hidePrices}
                            />
                          </li>
                        ))}
                      </ul>
                    );
                  })()}

                  {totalPages > 1 && (
                    <nav
                      className="mt-8 flex items-center justify-center gap-3"
                      aria-label={t("التنقل بين الصفحات", "Pagination")}
                    >
                      <button
                        type="button"
                        onClick={() => setPage(currentPage - 1)}
                        disabled={currentPage <= 1}
                        className="glass glass-pill flex items-center gap-1 px-4 py-2 text-sm text-muted disabled:opacity-40"
                        aria-label={t("الصفحة السابقة", "Previous page")}
                      >
                        <PrevIcon size={14} aria-hidden="true" />
                        {t("السابق", "Previous")}
                      </button>
                      <span className="text-sm text-muted" aria-current="page">
                        {currentPage} / {totalPages}
                      </span>
                      <button
                        type="button"
                        onClick={() => setPage(currentPage + 1)}
                        disabled={currentPage >= totalPages}
                        className="glass glass-pill flex items-center gap-1 px-4 py-2 text-sm text-muted disabled:opacity-40"
                        aria-label={t("الصفحة التالية", "Next page")}
                      >
                        {t("التالي", "Next")}
                        <NextIcon size={14} aria-hidden="true" />
                      </button>
                    </nav>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-white/10 bg-card/30 py-16">
        <div className="mx-auto max-w-2xl px-6 text-center">
          <h2 className="font-display text-2xl font-bold">{t("هل أنت معلم قرآن متخصص؟", "Are you a qualified Quran teacher?")}</h2>
          <p className="mt-2 text-sm text-muted">{t("انضم إلى فريقنا وساهم في تعليم القرآن للمسلمين حول العالم", "Join our team and help teach Quran to Muslims worldwide")}</p>
          <Link href="/contact?type=teacher" className="glass glass-pill mt-6 inline-block px-6 py-2.5 text-sm font-medium text-gold transition-colors hover:bg-gold hover:text-background">
            {t("تقدم الآن", "Apply Now")}
          </Link>
        </div>
      </section>

      <div className="border-t border-white/10"><Testimonials /></div>
      <RegisterBanner />
    </div>
  );
}
