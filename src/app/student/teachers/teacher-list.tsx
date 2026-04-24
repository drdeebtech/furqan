"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { GraduationCap, Star, Users, Search, SlidersHorizontal } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { SESSION_TYPE_AR, RIWAYA_AR } from "@/lib/constants";
import type { SessionType, RecitationStandard } from "@/types/database";

const SESSION_TYPE_EN: Record<SessionType, string> = {
  hifz: "Hifz", muraja: "Review", tajweed: "Tajweed", tilawa: "Tilawa",
  qiraat: "Qiraat", tafsir: "Tafsir", combined: "Hifz + Review", other: "Other",
};

const RIWAYA_EN: Record<RecitationStandard, string> = {
  hafs: "Hafs", warsh: "Warsh", qalon: "Qalun", al_duri: "Al-Duri", shu_ba: "Shu'ba",
};
import type { TeacherData } from "./page";
import { BookingSteps } from "@/components/shared/booking-steps";

const SPECIALTIES: { key: string; ar: string; en: string }[] = [
  { key: "all", ar: "الكل", en: "All" },
  { key: "hifz", ar: "حفظ", en: "Hifz" },
  { key: "tajweed", ar: "تجويد", en: "Tajweed" },
  { key: "muraja", ar: "مراجعة", en: "Review" },
  { key: "tilawa", ar: "تلاوة", en: "Tilawa" },
  { key: "qiraat", ar: "قراءات", en: "Qiraat" },
  { key: "tafsir", ar: "تفسير", en: "Tafsir" },
];

const GENDER_FILTERS: { key: string; ar: string; en: string }[] = [
  { key: "all", ar: "الكل", en: "All" },
  { key: "male", ar: "ذكر", en: "Male" },
  { key: "female", ar: "أنثى", en: "Female" },
];

export function TeacherList({ teachers }: { teachers: TeacherData[] }) {
  const [specialty, setSpecialty] = useState("all");
  const [gender, setGender] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"rating" | "sessions" | "price">("rating");
  const searchParams = useSearchParams();
  const { t, dir, lang } = useLang();
  const isNew = searchParams.get("new") === "1";

  const filtered = teachers
    .filter((tc) => {
      if (specialty !== "all" && !tc.specialties.includes(specialty)) return false;
      if (gender !== "all" && tc.gender !== gender) return false;
      if (searchQuery && !tc.name.includes(searchQuery)) return false;
      return true;
    })
    .sort((a, b) => {
      if (sortBy === "rating") return Number(b.rating_avg) - Number(a.rating_avg);
      if (sortBy === "sessions") return b.total_sessions - a.total_sessions;
      return a.hourly_rate - b.hourly_rate;
    });

  return (
    <div dir={dir} className="mx-auto max-w-5xl px-4 py-8">
      {isNew && (
        <>
          <BookingSteps current={1} />
          <div className="mb-6 glass-card p-5 text-center">
            <p className="text-lg font-bold text-gold">{t("مرحباً! اختر معلمك لتبدأ رحلتك مع القرآن", "Welcome! Choose your teacher to begin your journey with the Qur'an")}</p>
            <p className="mt-1 text-sm text-muted">{t("تصفح المعلمين واضغط \"احجز\" لحجز جلستك الأولى", "Browse teachers and press \"Book\" to schedule your first session")}</p>
          </div>
        </>
      )}
      <div className="mb-6">
        <h1 className="flex items-center gap-2 font-display text-2xl font-bold">
          <GraduationCap size={24} className="text-gold" />
          {t("المعلمون", "Teachers")}
        </h1>
        <p className="mt-1 text-xs text-muted">{t("تصفح المعلمين واحجز جلسة", "Browse teachers and book a session")}</p>
      </div>

      {/* Filters */}
      <div className="mb-6 space-y-3 glass-card p-4">
        {/* Search */}
        <div className="relative">
          <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("ابحث بالاسم...", "Search by name...")}
            aria-label={t("بحث", "Search")}
            className="w-full rounded-lg glass-input py-2 pe-4 ps-10 text-sm text-foreground placeholder:text-muted/50 focus:border-gold focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Specialty filter */}
          <div className="flex flex-wrap gap-1.5">
            {SPECIALTIES.map((s) => (
              <button
                key={s.key}
                onClick={() => setSpecialty(s.key)}
                className={`rounded-full px-3 py-1 text-xs transition-colors ${
                  specialty === s.key
                    ? "glass-gold font-medium text-white"
                    : "glass text-muted hover:border-gold/40"
                }`}
              >
                {lang === "ar" ? s.ar : s.en}
              </button>
            ))}
          </div>
        </div>

        {/* Gender + Sort */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">{t("الجنس:", "Gender:")}</span>
            {GENDER_FILTERS.map((g) => (
              <button
                key={g.key}
                onClick={() => setGender(g.key)}
                className={`rounded-full px-2.5 py-0.5 text-xs transition-colors ${
                  gender === g.key ? "glass-gold font-medium text-white" : "glass text-muted hover:border-gold/40"
                }`}
              >
                {t(g.ar, g.en)}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <SlidersHorizontal size={12} className="text-muted" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className="glass-input rounded-lg px-2 py-1 text-xs"
            >
              <option value="rating">{t("الأعلى تقييماً", "Top rated")}</option>
              <option value="sessions">{t("الأكثر خبرة", "Most experienced")}</option>
              <option value="price">{t("الأقل سعراً", "Lowest price")}</option>
            </select>
          </div>
        </div>

        <p className="text-xs text-muted">{filtered.length} {t("معلم", "teachers")}</p>
      </div>

      {/* Results */}
      {filtered.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Users size={32} className="mx-auto mb-3 text-muted" />
          <p className="text-muted">{t("لا يوجد معلمون مطابقون", "No matching teachers")}</p>
          <button onClick={() => { setSpecialty("all"); setSearchQuery(""); }} className="mt-3 text-sm text-gold hover:text-gold-light">
            {t("إعادة ضبط الفلاتر", "Reset filters")}
          </button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {filtered.map((teacher) => {
            const preferred = lang === "ar" ? teacher.bio : teacher.bio_en;
            const rawBio = preferred?.trim() ? preferred : (lang === "ar" ? teacher.bio_en : teacher.bio);
            const usedFallback = !!rawBio && !preferred?.trim();
            const bio = rawBio && rawBio.length > 100 ? rawBio.slice(0, 100) + "…" : rawBio;
            const bioDir = (usedFallback ? (lang === "ar" ? "ltr" : "rtl") : dir) as "rtl" | "ltr";

            return (
              <div key={teacher.teacher_id} className="glass-card p-4 md:p-5">
                {/* Compact mobile layout */}
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full glass text-lg font-bold md:h-14 md:w-14 md:text-xl">
                    {teacher.name.trim().charAt(0) || (lang === "ar" ? "؟" : "?")}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold md:text-lg">{teacher.name}</p>
                    <div className="flex items-center gap-0.5">
                      {[1, 2, 3, 4, 5].map((i) => (
                        <Star key={i} size={12} className={i <= Math.round(Number(teacher.rating_avg)) ? "fill-gold text-gold" : "text-card-border"} />
                      ))}
                      <span className="me-1 text-xs text-muted">{Number(teacher.rating_avg) > 0 ? Number(teacher.rating_avg).toFixed(1) : "—"}</span>
                    </div>
                  </div>
                  {/* Mobile: inline book button */}
                  <Link
                    href={`/student/bookings/new?teacher=${teacher.teacher_id}`}
                    className="shrink-0 rounded-lg glass-gold px-4 py-2 text-sm font-bold text-white transition-colors md:hidden"
                  >
                    {t("احجز", "Book")}
                  </Link>
                </div>

                {/* Desktop-only details */}
                {bio && (
                  <p dir={bioDir} className="mt-3 hidden text-sm leading-relaxed text-muted md:block">
                    {bio}
                    {usedFallback && (
                      <span className="ms-1 rounded border border-white/10 px-1 py-0.5 align-middle text-[10px] text-muted/60">
                        {lang === "ar" ? "EN" : "AR"}
                      </span>
                    )}
                  </p>
                )}
                <p className="mt-2 hidden text-xs text-muted md:block">{teacher.total_sessions} {t("جلسة مكتملة", "completed sessions")}</p>

                {/* Specialties — show top 3 on mobile, all on desktop */}
                {teacher.specialties.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {teacher.specialties.slice(0, 3).map((s) => (
                      <span key={s} className="glass glass-pill px-2 py-0.5 text-xs text-gold">
                        {(lang === "ar" ? SESSION_TYPE_AR[s as SessionType] : SESSION_TYPE_EN[s as SessionType]) ?? s}
                      </span>
                    ))}
                    {teacher.specialties.length > 3 && (
                      <span className="rounded-full px-2 py-0.5 text-xs text-muted md:hidden">+{teacher.specialties.length - 3}</span>
                    )}
                    {teacher.specialties.slice(3).map((s) => (
                      <span key={s} className="hidden glass glass-pill px-2 py-0.5 text-xs text-gold md:inline">
                        {(lang === "ar" ? SESSION_TYPE_AR[s as SessionType] : SESSION_TYPE_EN[s as SessionType]) ?? s}
                      </span>
                    ))}
                  </div>
                )}

                {/* Recitation standards — desktop only */}
                {teacher.recitation_standards.length > 0 && (
                  <div className="mt-2 hidden flex-wrap gap-1.5 md:flex">
                    {[...new Set(teacher.recitation_standards)].map((r) => (
                      <span key={r} className="glass-badge px-2 py-0.5 text-xs text-muted">
                        {(lang === "ar" ? RIWAYA_AR[r as RecitationStandard] : RIWAYA_EN[r as RecitationStandard]) ?? r}
                      </span>
                    ))}
                  </div>
                )}

                {/* Desktop: full-width book button */}
                <Link
                  href={`/student/bookings/new?teacher=${teacher.teacher_id}`}
                  className="mt-4 hidden w-full items-center justify-center gap-2 rounded-lg glass-gold py-2.5 font-semibold text-white transition-colors md:flex"
                >
                  {t("احجز جلسة", "Book Session")}
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
