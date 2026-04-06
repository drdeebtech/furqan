"use client";

import Link from "next/link";
import { Award, GraduationCap, Star } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { Testimonials } from "@/components/public/testimonials";
import { RegisterBanner } from "@/components/public/register-banner";

const SPECIALTY: Record<string, { ar: string; en: string }> = {
  hifz: { ar: "حفظ", en: "Hifz" }, muraja: { ar: "مراجعة", en: "Revision" },
  tajweed: { ar: "تجويد", en: "Tajweed" }, tilawa: { ar: "تلاوة", en: "Tilawa" },
  qiraat: { ar: "قراءات", en: "Qira'at" }, tafsir: { ar: "تفسير", en: "Tafsir" },
  combined: { ar: "حفظ + مراجعة", en: "Hifz + Revision" }, other: { ar: "أخرى", en: "Other" },
};

const RIWAYA: Record<string, { ar: string; en: string }> = {
  hafs: { ar: "حفص", en: "Hafs" }, warsh: { ar: "ورش", en: "Warsh" },
  qalon: { ar: "قالون", en: "Qalun" }, al_duri: { ar: "الدوري", en: "Al-Duri" },
  shu_ba: { ar: "شعبة", en: "Shu'ba" },
};

interface Teacher {
  id: string;
  name: string;
  bio: string | null;
  specialties: string[];
  recitationStandards: string[];
  hourlyRate: number;
  ratingAvg: number;
  totalSessions: number;
  gender: string | null;
}

export function TeachersContent({ teachers }: { teachers: Teacher[] }) {
  const { t } = useLang();

  return (
    <div>
      <section className="border-b border-card-border bg-card py-20 text-center">
        <p className="text-sm text-muted"><Link href="/" className="text-gold hover:text-gold-light">{t("الرئيسية", "Home")}</Link> / {t("المعلمون", "Teachers")}</p>
        <h1 className="font-display mt-4 text-5xl font-bold">{t("معلمونا", "Our Teachers")}</h1>
        <p className="mt-3 text-sm text-muted">{t(`${teachers.length} معلم معتمد`, `${teachers.length} certified teachers`)}</p>
      </section>

      <section className="border-b border-card-border py-8">
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
            <div className="rounded-2xl border border-card-border bg-card p-12 text-center">
              <GraduationCap size={32} className="mx-auto mb-3 text-muted" />
              <p className="text-muted">{t("نعمل على إضافة معلمين جدد — ترقبوا!", "We're adding new teachers — stay tuned!")}</p>
            </div>
          ) : (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {teachers.map((teacher) => (
                <div key={teacher.id} className="rounded-2xl border border-card-border bg-card p-6">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-gold/30 bg-gold/10 font-display text-2xl font-bold text-gold">
                    {teacher.name.charAt(0)}
                  </div>
                  <h2 className="mt-4 text-lg font-bold">{teacher.name}</h2>
                  {teacher.bio && (
                    <p className="mt-1 text-sm text-muted">
                      {teacher.bio.length > 100 ? teacher.bio.slice(0, 100) + "…" : teacher.bio}
                    </p>
                  )}
                  {teacher.gender === "female" && (
                    <p className="mt-1 text-xs text-gold">({t("للأخوات والأطفال", "Sisters & children")})</p>
                  )}

                  {teacher.specialties.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {teacher.specialties.map((s) => (
                        <span key={s} className="rounded-full border border-card-border bg-surface px-2.5 py-0.5 text-xs text-muted">
                          {SPECIALTY[s] ? t(SPECIALTY[s].ar, SPECIALTY[s].en) : s}
                        </span>
                      ))}
                    </div>
                  )}

                  {teacher.recitationStandards.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {[...new Set(teacher.recitationStandards)].map((r) => (
                        <span key={r} className="rounded-full border border-card-border px-2 py-0.5 text-xs text-muted">
                          {RIWAYA[r] ? t(RIWAYA[r].ar, RIWAYA[r].en) : r}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="mt-3 text-xs text-muted">
                    <p>{teacher.totalSessions} {t("جلسة مكتملة", "completed sessions")}</p>
                  </div>

                  <div className="mt-2 flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <Star key={i} size={12} className={i <= Math.round(teacher.ratingAvg) ? "fill-gold text-gold" : "text-card-border"} />
                    ))}
                    {teacher.ratingAvg > 0 && <span className="mr-1 text-xs text-muted">{teacher.ratingAvg.toFixed(1)}</span>}
                  </div>

                  <Link
                    href={`/contact?teacher=${encodeURIComponent(teacher.name)}`}
                    className="mt-4 block rounded border border-gold bg-gold/10 py-2 text-center text-sm font-medium text-gold transition-colors hover:bg-gold hover:text-background"
                  >
                    {t("احجز مع هذا المعلم", "Book with this Teacher")}
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="border-t border-card-border bg-card/30 py-16">
        <div className="mx-auto max-w-2xl px-6 text-center">
          <h2 className="font-display text-2xl font-bold">{t("هل أنت معلم قرآن متخصص؟", "Are you a qualified Quran teacher?")}</h2>
          <p className="mt-2 text-sm text-muted">{t("انضم إلى فريقنا وساهم في تعليم القرآن للمسلمين حول العالم", "Join our team and help teach Quran to Muslims worldwide")}</p>
          <Link href="/contact?type=teacher" className="mt-6 inline-block rounded border border-gold bg-gold/10 px-6 py-2.5 text-sm font-medium text-gold transition-colors hover:bg-gold hover:text-background">
            {t("تقدم الآن", "Apply Now")}
          </Link>
        </div>
      </section>

      <div className="border-t border-card-border"><Testimonials /></div>
      <RegisterBanner />
    </div>
  );
}
