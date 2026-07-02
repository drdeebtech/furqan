"use client";

import Link from "next/link";
import Image from "next/image";
import { Award, GraduationCap, Star } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { useFeatureFlags } from "@/lib/feature-flags-context";
import { TEACHER_LANGUAGES } from "@/lib/constants";
import { PRICING_MODEL } from "@/lib/copy/policies";
import { Testimonials } from "@/components/public/testimonials";
import { RegisterBanner } from "@/components/public/register-banner";

type LabelMap = Record<string, { ar: string; en: string }>;

interface Teacher {
  id: string;
  name: string;
  nameAr: string | null;
  avatarUrl: string | null;
  bio: string | null;
  bioEn: string | null;
  languages: string[];
  specialties: string[];
  recitationStandards: string[];
  hourlyRate: number;
  ratingAvg: number;
  ratingCount: number;
  totalSessions: number;
  gender: string | null;
}

export function TeachersContent({
  teachers,
  specialtyLabels,
  recitationLabels,
}: {
  teachers: Teacher[];
  specialtyLabels: LabelMap;
  recitationLabels: LabelMap;
}) {
  const { t, lang } = useLang();
  const { hidePrices } = useFeatureFlags();

  // Map a stored language code (ar/en/ur/…) to its bilingual label.
  function languageLabel(code: string): string {
    const m = TEACHER_LANGUAGES.find((l) => l.key === code);
    return m ? t(m.ar, m.en) : code;
  }

  // Decide which name to show on each card. Prefer the Arabic spelling for
  // Arabic visitors; fall back to the English name when the teacher hasn't
  // filled their Arabic name yet — showing a real name beats showing "—".
  function pickDisplayName(teacher: Teacher): string {
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
          <p className="mt-3 text-sm text-muted">{t(`${teachers.length} معلم معتمد`, `${teachers.length} certified teachers`)}</p>
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

      <section className="py-24">
        <div className="mx-auto max-w-7xl px-6">
          {teachers.length === 0 ? (
            <div className="glass-card p-12 text-center">
              <GraduationCap size={32} className="mx-auto mb-3 text-muted" />
              <p className="text-muted">{t("نعمل على إضافة معلمين جدد — ترقبوا!", "We're adding new teachers — stay tuned!")}</p>
            </div>
          ) : (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {teachers.map((teacher) => {
                const displayName = pickDisplayName(teacher);
                // Prefer the English bio for English visitors; fall back to the
                // Arabic bio when the teacher hasn't filled an English one.
                const displayBio =
                  lang === "en" ? teacher.bioEn?.trim() || teacher.bio : teacher.bio;
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
                      {/* spec 035 US2 (FR-005/T017): name the riwayah the teacher
                          holds ijazah in — a specific, checkable claim, not a
                          generic "certified" tag. */}
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
                    {/* spec 035 US1 (FR-006): a real teacher with no completed
                        sessions is shown as "New", not a bare 0-counter. */}
                    {teacher.totalSessions > 0 ? (
                      <p>{teacher.totalSessions} {t("جلسة مكتملة", "completed sessions")}</p>
                    ) : (
                      <p className="text-gold">{t("معلم جديد", "New teacher")}</p>
                    )}
                  </div>

                  {/* #542: only show the aggregate once a teacher has ≥3 ratings */}
                  {teacher.ratingCount >= 3 && (
                    <div className="mt-2 flex items-center gap-1">
                      {[1, 2, 3, 4, 5].map((i) => (
                        <Star key={i} size={12} className={i <= Math.round(teacher.ratingAvg) ? "fill-gold text-gold" : "text-card-border"} />
                      ))}
                      <span className="me-1 text-xs text-muted">{teacher.ratingAvg.toFixed(1)}</span>
                      <span className="text-xs text-muted">({teacher.ratingCount})</span>
                    </div>
                  )}

                  {/* spec 035 US2 (FR-002/T016): make the card a chooser, not a
                      flat directory — show languages, availability, and (when
                      the admin price toggle is off) a price preview. Dignified
                      placeholders where data is genuinely absent. */}
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
          )}
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
