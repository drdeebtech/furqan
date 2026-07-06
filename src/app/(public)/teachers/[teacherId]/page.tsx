import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { Award, BookOpen, GraduationCap, Mic, Star } from "lucide-react";
import { getT } from "@/lib/i18n/server";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPublicTeacher } from "@/lib/supabase/teacher-search";
import { TEACHER_LANGUAGES } from "@/lib/constants";
import { PRICING_MODEL } from "@/lib/copy/policies";
import { PersonSchema } from "@/components/seo/structured-data";
import { logError } from "@/lib/logger";

// Env-driven so preview/staging emit their own canonical/OG origin rather than
// production. Falls back to the production origin when unset.
const SITE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.furqan.today";
const FALLBACK_TITLE = "معلم — فرقان | Teacher — Furqan";

// React.cache dedupes the single-row RPC across generateMetadata + page render
// within one request. The memoized result (value, null, or thrown error) is
// consistent for both callers.
const getCachedTeacher = cache(getPublicTeacher);

interface PageProps {
  params: Promise<{ teacherId: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { teacherId } = await params;
  let teacher = null;
  try {
    teacher = await getCachedTeacher(teacherId);
  } catch (err) {
    // Best-effort metadata: a server error must not tank the response's <head>.
    // The page render itself will surface the error via its own error path.
    logError("generateMetadata: getPublicTeacher failed", err, {
      route: "/teachers/[teacherId]",
      widget: "public-teacher-profile",
      teacherId,
    });
    return { title: FALLBACK_TITLE };
  }

  if (!teacher) return { title: FALLBACK_TITLE };

  const name = teacher.name && teacher.name !== "—" ? teacher.name : "Furqan Teacher";
  const title = `${name} — ${teacher.nameAr ?? "معلم قرآن"} | Quran Teacher`;
  const description =
    (teacher.bioEn ?? teacher.bio) ??
    "Quran teacher at Furqan Academy with verified Ijazah credentials.";
  const url = `${SITE_URL}/teachers/${teacher.id}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      siteName: "فرقان — FURQAN",
      type: "profile",
      ...(teacher.avatarUrl ? { images: [teacher.avatarUrl] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      ...(teacher.avatarUrl ? { images: [teacher.avatarUrl] } : {}),
    },
  };
}

export default async function PublicTeacherProfilePage({ params }: PageProps) {
  const { teacherId } = await params;
  const { t, dir, lang } = await getT();
  const settings = await getSettings();
  const hidePrices = settings["hide_prices"] === "true";

  const teacher = await getCachedTeacher(teacherId);
  if (!teacher) notFound();

  // Public label picklists (admin client, same pattern as the marketplace listing).
  const supabase = createAdminClient();
  const [specRes, recRes] = await Promise.all([
    supabase.from("teacher_specialties").select("key, label_ar, label_en").eq("is_active", true),
    supabase.from("teacher_recitations").select("key, label_ar, label_en").eq("is_active", true),
  ]);
  // Surface (not swallow) label-lookup errors; the page still renders with raw
  // keys as a graceful fallback, but the failure is logged, not hidden.
  if (specRes.error) {
    logError("public teacher profile: specialty labels failed", specRes.error, {
      route: "/teachers/[teacherId]", widget: "public-teacher-profile", teacherId,
    });
  }
  if (recRes.error) {
    logError("public teacher profile: recitation labels failed", recRes.error, {
      route: "/teachers/[teacherId]", widget: "public-teacher-profile", teacherId,
    });
  }
  const specData = specRes.data;
  const recData = recRes.data;
  const specRows = specData ?? [];
  const recRows = recData ?? [];
  const specialtyLabels: Record<string, { ar: string; en: string }> = Object.fromEntries(
    specRows.map((r) => [r.key, { ar: r.label_ar, en: r.label_en }]),
  );
  const recitationLabels: Record<string, { ar: string; en: string }> = Object.fromEntries(
    recRows.map((r) => [r.key, { ar: r.label_ar, en: r.label_en }]),
  );

  function languageLabel(code: string): string {
    const m = TEACHER_LANGUAGES.find((l) => l.key === code);
    return m ? t(m.ar, m.en) : code;
  }
  function specialtyLabel(key: string): string {
    const e = specialtyLabels[key];
    return e ? t(e.ar, e.en) : key;
  }
  function recitationLabel(key: string): string {
    const e = recitationLabels[key];
    return e ? t(e.ar, e.en) : key;
  }

  // Same bilingual display rule as the marketplace card (pickDisplayName).
  const displayName = lang === "ar" ? (teacher.nameAr?.trim() || teacher.name) : teacher.name;
  // Full bio — never truncated. Arabic falls back to English if only en is set.
  const bio = lang === "ar" ? (teacher.bio ?? teacher.bioEn) : (teacher.bioEn ?? teacher.bio);
  const bioDir = bio ? dir : undefined;
  const showRating = teacher.ratingCount >= 3;
  const contactHref = `/contact?teacher=${encodeURIComponent(teacher.name)}`;

  return (
    <div dir={dir} className="mx-auto max-w-3xl px-4 py-8">
      <PersonSchema
        name={teacher.name}
        alternateName={teacher.nameAr}
        image={teacher.avatarUrl ?? undefined}
        knowsLanguage={teacher.languages.map(
          (c) => TEACHER_LANGUAGES.find((l) => l.key === c)?.en ?? c,
        )}
        ratingAvg={teacher.ratingAvg}
        ratingCount={teacher.ratingCount}
      />

      <nav aria-label={t("مسار الصفحة", "Breadcrumb")} className="mb-4 text-xs text-muted-light">
        <Link href="/" className="text-gold transition-colors hover:text-gold-light focus-ring">
          {t("الرئيسية", "Home")}
        </Link>
        <span className="mx-2" aria-hidden="true">/</span>
        <Link href="/teachers" className="text-gold transition-colors hover:text-gold-light focus-ring">
          {t("المعلمون", "Teachers")}
        </Link>
        <span className="mx-2" aria-hidden="true">/</span>
        <span className="text-muted" aria-current="page">{displayName}</span>
      </nav>

      {/* Header card — avatar, bilingual name, rating, sessions, hourly rate */}
      <div className="glass-card p-6">
        <div className="flex flex-wrap items-start gap-5">
          {teacher.avatarUrl ? (
            <Image
              src={teacher.avatarUrl}
              alt={displayName}
              width={96}
              height={96}
              className="h-24 w-24 rounded-full border-2 border-gold/40 object-cover"
              unoptimized
              priority
            />
          ) : (
            <div
              className="flex h-24 w-24 items-center justify-center rounded-full border-2 border-gold/30 bg-gold/10 font-display text-3xl font-bold text-gold"
              aria-hidden="true"
            >
              {displayName.charAt(0)}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-3xl font-bold leading-tight text-foreground">
              {displayName}
            </h1>
            {teacher.gender === "female" && (
              <p className="mt-1 text-xs text-gold">({t("للأخوات والأطفال", "Sisters & children")})</p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-muted">
              {showRating && (
                <div
                  className="flex items-center gap-1"
                  aria-label={t(`تقييم ${teacher.ratingAvg.toFixed(1)} من ٥`, `Rated ${teacher.ratingAvg.toFixed(1)} of 5`)}
                >
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Star
                      key={i}
                      size={14}
                      className={i <= Math.round(teacher.ratingAvg) ? "fill-gold text-gold" : "text-card-border"}
                      aria-hidden="true"
                    />
                  ))}
                  <span className="ms-1">{teacher.ratingAvg.toFixed(1)}</span>
                  <span className="text-xs">({teacher.ratingCount})</span>
                </div>
              )}
              <div className="flex items-center gap-1">
                <BookOpen size={14} className="text-gold" aria-hidden="true" />
                {teacher.totalSessions > 0 ? (
                  <>{teacher.totalSessions} {t("جلسة مكتملة", "completed sessions")}</>
                ) : (
                  <>{t("معلم جديد", "New teacher")}</>
                )}
              </div>
              {!hidePrices && (
                <div className="flex items-center gap-1">
                  <span className="text-gold" dir="ltr">
                    {teacher.hourlyRate > 0 ? `$${teacher.hourlyRate} / ${t("ساعة", "hr")}` : "—"}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Full bio — not truncated (spec 037 T4) */}
      {bio && (
        <div className="glass-card mt-4 p-6">
          <h2 className="mb-3 text-sm font-semibold text-gold">{t("نبذة عن المعلم", "About the teacher")}</h2>
          <p dir={bioDir} className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap">
            {bio}
          </p>
        </div>
      )}

      {/* Languages */}
      {teacher.languages.length > 0 && (
        <div className="glass-card mt-4 p-6">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gold">
            <GraduationCap size={14} aria-hidden="true" />
            {t("اللغات", "Languages")}
          </h2>
          <div className="flex flex-wrap gap-2">
            {teacher.languages.map((c) => (
              <span key={c} className="glass-badge px-3 py-1 text-xs text-muted">{languageLabel(c)}</span>
            ))}
          </div>
        </div>
      )}

      {/* Specialties */}
      {teacher.specialties.length > 0 && (
        <div className="glass-card mt-4 p-6">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gold">
            <Award size={14} aria-hidden="true" />
            {t("التخصصات", "Specialties")}
          </h2>
          <div className="flex flex-wrap gap-2">
            {teacher.specialties.map((s) => (
              <span key={s} className="glass glass-pill px-3 py-1 text-xs text-gold">{specialtyLabel(s)}</span>
            ))}
          </div>
        </div>
      )}

      {/* Recitation standards (ijazah) */}
      {teacher.recitationStandards.length > 0 && (
        <div className="glass-card mt-4 p-6">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gold">
            <Mic size={14} aria-hidden="true" />
            {t("روايات القراءة", "Recitation styles")}
          </h2>
          <div className="flex flex-wrap gap-2">
            {[...new Set(teacher.recitationStandards)].map((r) => (
              <span key={r} className="glass-badge px-3 py-1 text-xs text-muted">{recitationLabel(r)}</span>
            ))}
          </div>
        </div>
      )}

      {/* Pricing caption — same gate as the marketplace card */}
      {!hidePrices && teacher.hourlyRate > 0 && (
        <p className="mt-4 text-center text-[11px] leading-snug text-muted">
          {t(PRICING_MODEL.teacherRateCaption.ar, PRICING_MODEL.teacherRateCaption.en)}
        </p>
      )}

      {/* Booking CTA — same target as the marketplace card (/contact?teacher=…). */}
      <div className="mt-6">
        <Link
          href={contactHref}
          className="focus-ring flex w-full items-center justify-center gap-2 rounded-xl glass-gold py-4 text-base font-bold text-white transition-colors"
          aria-label={t(`احجز جلسة مع ${displayName}`, `Book a session with ${displayName}`)}
        >
          {t("احجز جلسة", "Book a session")}
        </Link>
      </div>
    </div>
  );
}
