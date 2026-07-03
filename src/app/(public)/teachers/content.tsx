"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Award, ChevronLeft, ChevronRight, GraduationCap, Star } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { useFeatureFlags } from "@/lib/feature-flags-context";
import { TEACHER_LANGUAGES } from "@/lib/constants";
import { PRICING_MODEL } from "@/lib/copy/policies";
import { Testimonials } from "@/components/public/testimonials";
import { RegisterBanner } from "@/components/public/register-banner";
import { TeacherSearchInput } from "@/components/public/teacher-search-input";
import { TeacherFilterBar, type FilterState } from "@/components/public/teacher-filter-bar";
import { TeacherGridSkeleton } from "@/components/public/teacher-card-skeleton";
import type { TeacherCard, TeacherSearchResult } from "@/lib/supabase/teacher-search";

type LabelMap = Record<string, { ar: string; en: string }>;

const PAGE_LIMIT = 12;

export function TeachersContent({
  initialTeachers,
  specialtyLabels,
  recitationLabels,
}: {
  initialTeachers: TeacherCard[];
  specialtyLabels: LabelMap;
  recitationLabels: LabelMap;
}) {
  const { t, lang } = useLang();
  const { hidePrices } = useFeatureFlags();
  const router = useRouter();
  const searchParams = useSearchParams();

  // fetchedFor tracks which searchParams string was last resolved (enables derived isLoading)
  const [fetchedFor, setFetchedFor] = useState("");
  const [apiResult, setApiResult] = useState<{ teachers: TeacherCard[]; total: number } | null>(null);

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
      .then((r) => r.json())
      .then((data: TeacherSearchResult) => {
        setApiResult({ teachers: data.teachers ?? [], total: data.total ?? 0 });
        setFetchedFor(key); // async — not flagged by set-state-in-effect
      })
      .catch(() => {}); // silently ignore AbortError on dep change
    return () => controller.abort();
  }, [searchParams, hasFilters, searchKey]);

  function setParam(key: string, value: string) {
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

  function languageLabel(code: string): string {
    const m = TEACHER_LANGUAGES.find((l) => l.key === code);
    return m ? t(m.ar, m.en) : code;
  }

  function pickDisplayName(teacher: TeacherCard): string {
    if (lang === "ar") {
      const ar = teacher.nameAr?.trim();
      if (ar) return ar;
    }
    return teacher.name;
  }

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
            {hasFilters
              ? t(`${total} نتيجة`, `${total} results`)
              : t(`${total} معلم معتمد`, `${total} certified teachers`)}
          </p>
        </div>
      </section>

      <section className="border-b border-white/10 py-8">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-center gap-8 px-6">
          {[
            { icon: Award, ar: "حاصلون على الإجازة", en: "Certified with Ijazah" },
            { icon: GraduationCap, ar: "خريجو أفضل الجامعات الإسلامية", en: "Top Islamic University Graduates" },
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
                  <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                    {teachers.map((teacher) => {
                      const displayName = pickDisplayName(teacher);
                      const displayBio = lang === "en" ? teacher.bioEn?.trim() || teacher.bio : teacher.bio;
                      return (
                        <div
                          key={teacher.id}
                          id={`teacher-${teacher.id}`}
                          className="glass-card p-6 scroll-mt-24 target:ring-2 target:ring-gold"
                        >
                          {teacher.avatarUrl ? (
                            <Image
                              src={teacher.avatarUrl}
                              alt={displayName}
                              width={80}
                              height={80}
                              className="h-20 w-20 rounded-full border-2 border-gold/40 object-cover"
                              loading="lazy"
                              unoptimized
                            />
                          ) : (
                            <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-gold/30 bg-gold/10 font-display text-2xl font-bold text-gold">
                              {displayName.charAt(0)}
                            </div>
                          )}
                          <h2 className="mt-4 text-lg font-bold">{displayName}</h2>
                          {displayBio && (
                            <p className="mt-1 text-sm text-muted">
                              {displayBio.length > 100 ? displayBio.slice(0, 100) + "…" : displayBio}
                            </p>
                          )}
                          {teacher.gender === "female" && (
                            <p className="mt-1 text-xs text-gold">({t("للأخوات والأطفال", "Sisters & children")})</p>
                          )}
                          {teacher.specialties.length > 0 && (
                            <div className="mt-3 flex flex-wrap gap-1.5">
                              {teacher.specialties.map((s) => (
                                <span key={s} className="glass-badge px-2.5 py-0.5 text-xs text-muted">
                                  {specialtyLabels[s] ? t(specialtyLabels[s].ar, specialtyLabels[s].en) : s}
                                </span>
                              ))}
                            </div>
                          )}
                          {teacher.recitationStandards.length > 0 && (
                            <div className="mt-2">
                              <p className="flex items-center gap-1 text-xs font-medium text-gold">
                                <Award size={12} aria-hidden="true" />
                                {t("إجازة في الرواية", "Ijazah in riwayah")}
                              </p>
                              <div className="mt-1 flex flex-wrap gap-1.5">
                                {[...new Set(teacher.recitationStandards)].map((r) => (
                                  <span key={r} className="glass-badge px-2 py-0.5 text-xs text-muted">
                                    {recitationLabels[r] ? t(recitationLabels[r].ar, recitationLabels[r].en) : r}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          <div className="mt-3 text-xs text-muted">
                            {teacher.totalSessions > 0 ? (
                              <p>{teacher.totalSessions} {t("جلسة مكتملة", "completed sessions")}</p>
                            ) : (
                              <p className="text-gold">{t("معلم جديد", "New teacher")}</p>
                            )}
                          </div>
                          {teacher.ratingCount >= 3 && (
                            <div className="mt-2 flex items-center gap-1">
                              {[1, 2, 3, 4, 5].map((i) => (
                                <Star key={i} size={12} className={i <= Math.round(teacher.ratingAvg) ? "fill-gold text-gold" : "text-card-border"} />
                              ))}
                              <span className="me-1 text-xs text-muted">{teacher.ratingAvg.toFixed(1)}</span>
                              <span className="text-xs text-muted">({teacher.ratingCount})</span>
                            </div>
                          )}
                          <dl className="mt-3 space-y-1 text-xs text-muted">
                            {teacher.languages.length > 0 && (
                              <div className="flex gap-1.5">
                                <dt className="font-medium text-muted-light">{t("اللغات", "Languages")}:</dt>
                                <dd>{teacher.languages.map(languageLabel).join(t("، ", ", "))}</dd>
                              </div>
                            )}
                            <div className="flex gap-1.5">
                              <dt className="font-medium text-muted-light">{t("التوفر", "Availability")}:</dt>
                              <dd>{t("حسب الاتفاق", "Schedule on request")}</dd>
                            </div>
                            {!hidePrices && (
                              <div className="flex flex-col gap-0.5">
                                <div className="flex gap-1.5">
                                  <dt className="font-medium text-muted-light">{t("السعر", "Price")}:</dt>
                                  <dd><span dir="ltr">{teacher.hourlyRate > 0 ? `$${teacher.hourlyRate} / ${t("ساعة", "hr")}` : "—"}</span></dd>
                                </div>
                                {teacher.hourlyRate > 0 && (
                                  <span className="text-[11px] leading-snug text-muted">
                                    {t(PRICING_MODEL.teacherRateCaption.ar, PRICING_MODEL.teacherRateCaption.en)}
                                  </span>
                                )}
                              </div>
                            )}
                          </dl>
                          <Link
                            href={`/contact?teacher=${encodeURIComponent(teacher.name)}`}
                            className="glass glass-pill mt-4 block py-2 text-center text-sm font-medium text-gold transition-colors hover:bg-gold hover:text-background"
                          >
                            {t("احجز مع هذا المعلم", "Book with this Teacher")}
                          </Link>
                        </div>
                      );
                    })}
                  </div>

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
                        <ChevronRight size={14} aria-hidden="true" />
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
                        <ChevronLeft size={14} aria-hidden="true" />
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
