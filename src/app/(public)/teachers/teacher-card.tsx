import Link from "next/link";
import Image from "next/image";
import { Award, Star } from "lucide-react";
import { TEACHER_LANGUAGES } from "@/lib/constants";
import { PRICING_MODEL } from "@/lib/copy/policies";
import type { TeacherCard as TeacherCardData } from "@/lib/supabase/teacher-search";

type LabelMap = Record<string, { ar: string; en: string }>;
type Variant = "featured" | "compact" | "default";
type TFunc = (ar: string, en: string) => string;

export interface TeacherCardProps {
  teacher: TeacherCardData;
  variant?: Variant;
  specialtyLabels: LabelMap;
  recitationLabels: LabelMap;
  t: TFunc;
  lang: "ar" | "en";
  hidePrices: boolean;
}

/**
 * Public marketplace teacher card. Three visual variants share one data model:
 *
 *  - "default"  — today's marketplace card; used for pages 2+ and thin supply.
 *  - "featured" — top-of-page-1 primacy: larger card, prominent sessions/rating
 *                 stat block, honest gold-as-text "among our most experienced"
 *                 label (only when totalSessions > 0, since the RPC sorts by
 *                 sessions DESC — being featured literally means top-N by
 *                 sessions, so the label is derived, not fabricated).
 *  - "compact"  — denser grid below featured; demotes languages/availability.
 *
 * DESIGN.md compliance:
 *  - One Metal: gold is the only brand accent on the card; the rating stars and
 *    the honest label are the only gold accents, everything else is tonal.
 *  - Gold-As-Text: gold appears only as text (label, stars, CTA outline) — no
 *    gold fills on low-signal chrome.
 *  - Bilingual-First: every string passes through t(ar, en); bio picks ar/en
 *    by lang with the same fallback rule as the original card.
 *  - No-Kicker: the honest label is sentence-case, not an uppercase tracked
 *    eyebrow.
 */
export function TeacherCard({
  teacher,
  variant = "default",
  specialtyLabels,
  recitationLabels,
  t,
  lang,
  hidePrices,
}: TeacherCardProps) {
  const displayName =
    lang === "ar" && teacher.nameAr?.trim() ? teacher.nameAr.trim() : teacher.name;
  const displayBio =
    lang === "en" ? teacher.bioEn?.trim() || teacher.bio : teacher.bio;

  function languageLabel(code: string): string {
    const m = TEACHER_LANGUAGES.find((l) => l.key === code);
    return m ? t(m.ar, m.en) : code;
  }

  if (variant === "featured") {
    return (
      <article
        id={`teacher-${teacher.id}`}
        className="glass-card hover-lift scroll-mt-24 target:ring-2 target:ring-gold p-6 sm:p-8"
      >
        <Link
          href={`/teachers/${teacher.id}`}
          className="group focus-ring block rounded-xl"
          aria-label={t(`عرض ملف ${displayName}`, `View profile of ${displayName}`)}
        >
          <div className="flex items-start gap-5">
            {teacher.avatarUrl ? (
              <Image
                src={teacher.avatarUrl}
                alt={displayName}
                width={96}
                height={96}
                className="h-20 w-20 shrink-0 rounded-full border-2 border-gold/50 object-cover sm:h-24 sm:w-24"
                loading="lazy"
                unoptimized
              />
            ) : (
              <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full border-2 border-gold/40 bg-gold/10 font-display text-2xl font-bold text-gold sm:h-24 sm:w-24 sm:text-3xl">
                {displayName.charAt(0)}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <h3 className="text-xl font-bold leading-tight transition-colors group-hover:text-gold sm:text-2xl">
                {displayName}
              </h3>
              {/* Honest, gold-as-text label — only when totalSessions > 0.
                  The list is sorted by sessions DESC, so being in the
                  featured tier literally means top-N by sessions. */}
              {teacher.totalSessions > 0 && (
                <p className="mt-1 text-sm text-gold">
                  {t("من الأكثر خبرة", "Among our most experienced")}
                </p>
              )}
              {teacher.gender === "female" && (
                <p className="mt-1 text-xs text-muted-light">
                  ({t("للأخوات والأطفال", "Sisters & children")})
                </p>
              )}
            </div>
          </div>
        </Link>

        {/* Promoted signal stats — sessions + rating (rating only when ≥3). */}
        <dl className="mt-6 grid grid-cols-2 gap-4 border-y border-white/10 py-4">
          <div>
            <dt className="text-xs text-muted">{t("جلسة مكتملة", "Completed sessions")}</dt>
            <dd className="mt-1 font-sans text-3xl font-bold tabular-nums text-foreground">
              {teacher.totalSessions}
            </dd>
          </div>
          {teacher.ratingCount >= 3 ? (
            <div>
              <dt className="text-xs text-muted">{t("التقييم", "Rating")}</dt>
              <dd className="mt-1 flex items-baseline gap-2">
                <span className="font-sans text-2xl font-bold tabular-nums text-foreground">
                  {teacher.ratingAvg.toFixed(1)}
                </span>
                <span className="flex flex-col">
                  <span className="flex items-center gap-0.5" aria-hidden="true">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <Star
                        key={i}
                        size={12}
                        className={
                          i <= Math.round(teacher.ratingAvg)
                            ? "fill-gold text-gold"
                            : "text-card-border"
                        }
                      />
                    ))}
                  </span>
                  <span className="text-[11px] text-muted">
                    ({teacher.ratingCount} {t("تقييم", "reviews")})
                  </span>
                </span>
              </dd>
            </div>
          ) : (
            <div>
              <dt className="text-xs text-muted">{t("الحالة", "Status")}</dt>
              <dd className="mt-1 text-sm text-muted-light">
                {t("متاح للطلاب الجدد", "Open to new students")}
              </dd>
            </div>
          )}
        </dl>

        {displayBio && (
          <p className="mt-4 text-sm text-muted">
            {displayBio.length > 180 ? displayBio.slice(0, 180) + "…" : displayBio}
          </p>
        )}

        {teacher.specialties.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {teacher.specialties.map((s) => (
              <span key={s} className="glass-badge px-2.5 py-0.5 text-xs text-muted">
                {specialtyLabels[s] ? t(specialtyLabels[s].ar, specialtyLabels[s].en) : s}
              </span>
            ))}
          </div>
        )}

        {teacher.recitationStandards.length > 0 && (
          <div className="mt-3">
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

        <dl className="mt-4 space-y-1 text-xs text-muted">
          {teacher.languages.length > 0 && (
            <div className="flex gap-1.5">
              <dt className="font-medium text-muted-light">{t("اللغات", "Languages")}:</dt>
              <dd>{teacher.languages.map(languageLabel).join(t("، ", ", "))}</dd>
            </div>
          )}
          {!hidePrices && (
            <div className="flex flex-col gap-0.5">
              <div className="flex gap-1.5">
                <dt className="font-medium text-muted-light">{t("السعر", "Price")}:</dt>
                <dd>
                  <span dir="ltr">
                    {teacher.hourlyRate > 0
                      ? `$${teacher.hourlyRate} / ${t("ساعة", "hr")}`
                      : "—"}
                  </span>
                </dd>
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
          className="glass glass-pill min-h-11 mt-6 flex items-center justify-center py-2.5 text-center text-sm font-medium text-gold transition-colors hover:bg-gold hover:text-background"
        >
          {t("احجز مع هذا المعلم", "Book with this Teacher")}
        </Link>
      </article>
    );
  }

  if (variant === "compact") {
    return (
      <article
        id={`teacher-${teacher.id}`}
        className="glass-card scroll-mt-24 target:ring-2 target:ring-gold p-5"
      >
        <Link
          href={`/teachers/${teacher.id}`}
          className="group focus-ring block rounded-xl"
          aria-label={t(`عرض ملف ${displayName}`, `View profile of ${displayName}`)}
        >
          {teacher.avatarUrl ? (
            <Image
              src={teacher.avatarUrl}
              alt={displayName}
              width={56}
              height={56}
              className="h-14 w-14 rounded-full border border-gold/40 object-cover"
              loading="lazy"
              unoptimized
            />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-full border border-gold/30 bg-gold/10 font-display text-xl font-bold text-gold">
              {displayName.charAt(0)}
            </div>
          )}
          <h3 className="mt-3 text-base font-bold leading-tight transition-colors group-hover:text-gold">
            {displayName}
          </h3>
        </Link>
        {teacher.gender === "female" && (
          <p className="mt-1 text-xs text-muted-light">
            ({t("للأخوات والأطفال", "Sisters & children")})
          </p>
        )}
        {/* ONE key stat: sessions completed, or "New teacher" when 0. */}
        <p className="mt-2 text-xs text-muted">
          {teacher.totalSessions > 0 ? (
            <>
              {teacher.totalSessions} {t("جلسة مكتملة", "completed sessions")}
            </>
          ) : (
            <span className="text-muted">{t("معلم جديد", "New teacher")}</span>
          )}
        </p>
        {!hidePrices && (
          <p className="mt-1 text-xs text-muted-light">
            <span dir="ltr">
              {teacher.hourlyRate > 0
                ? `$${teacher.hourlyRate} / ${t("ساعة", "hr")}`
                : "—"}
            </span>
          </p>
        )}
        <Link
          href={`/contact?teacher=${encodeURIComponent(teacher.name)}`}
          className="glass glass-pill min-h-11 mt-3 flex items-center justify-center py-1.5 text-center text-xs font-medium text-gold transition-colors hover:bg-gold hover:text-background"
        >
          {t("احجز", "Book")}
        </Link>
      </article>
    );
  }

  // default — preserves today's marketplace card exactly.
  return (
    <div
      id={`teacher-${teacher.id}`}
      className="glass-card p-6 scroll-mt-24 target:ring-2 target:ring-gold"
    >
      <Link
        href={`/teachers/${teacher.id}`}
        className="group focus-ring block rounded-xl"
        aria-label={t(`عرض ملف ${displayName}`, `View profile of ${displayName}`)}
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
        <h2 className="mt-4 text-lg font-bold transition-colors group-hover:text-gold">{displayName}</h2>
      </Link>
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
          <p>
            {teacher.totalSessions} {t("جلسة مكتملة", "completed sessions")}
          </p>
        ) : (
          <p className="text-muted">{t("معلم جديد", "New teacher")}</p>
        )}
      </div>
      {teacher.ratingCount >= 3 && (
        <div className="mt-2 flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((i) => (
            <Star
              key={i}
              size={12}
              className={
                i <= Math.round(teacher.ratingAvg)
                  ? "fill-gold text-gold"
                  : "text-card-border"
              }
            />
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
              <dd>
                <span dir="ltr">
                  {teacher.hourlyRate > 0
                    ? `$${teacher.hourlyRate} / ${t("ساعة", "hr")}`
                    : "—"}
                </span>
              </dd>
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
        className="glass glass-pill min-h-11 mt-4 flex items-center justify-center py-2 text-center text-sm font-medium text-gold transition-colors hover:bg-gold hover:text-background"
      >
        {t("احجز مع هذا المعلم", "Book with this Teacher")}
      </Link>
    </div>
  );
}
