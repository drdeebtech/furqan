"use client";

import Link from "next/link";
import { Award, GraduationCap, Star } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { Testimonials } from "@/components/public/testimonials";
import { FreeTrialBanner } from "@/components/public/free-trial-banner";

const TEACHERS = [
  { ar: "الشيخ محمد العمري", en: "Sheikh Mohammed Al-Omari", initial: "م", titleAr: "متخصص في الحفظ والتجويد", titleEn: "Hifz & Tajweed Specialist", uniAr: "خريج جامعة الأزهر الشريف", uniEn: "Al-Azhar University Graduate", specAr: ["حفظ", "تجويد", "مراجعة"], specEn: ["Hifz", "Tajweed", "Revision"], riwaya: "Hafs", exp: "10", sessions: "500+" },
  { ar: "الشيخة أمينة الشريف", en: "Sheikha Amina Al-Sharif", initial: "أ", titleAr: "متخصصة في تعليم الأطفال والأخوات", titleEn: "Children & Sisters Specialist", uniAr: "خريجة جامعة أم القرى", uniEn: "Umm Al-Qura University Graduate", specAr: ["تجويد", "تلاوة", "أطفال"], specEn: ["Tajweed", "Tilawa", "Children"], riwaya: "Hafs", exp: "8", sessions: "350+", noteAr: "للأخوات والأطفال فقط", noteEn: "Sisters & children only" },
  { ar: "الشيخ عبدالرحمن فارس", en: "Sheikh Abdulrahman Faris", initial: "ع", titleAr: "متخصص في الحفظ والمراجعة", titleEn: "Memorization & Revision Specialist", uniAr: "خريج الجامعة الإسلامية بالمدينة", uniEn: "Islamic University of Madinah Graduate", specAr: ["حفظ", "مراجعة"], specEn: ["Hifz", "Revision"], riwaya: "Hafs", exp: "12", sessions: "600+" },
  { ar: "الشيخ يوسف الحسني", en: "Sheikh Yusuf Al-Hasani", initial: "ي", titleAr: "متخصص في القراءات", titleEn: "Qira'at Specialist", uniAr: "خريج جامعة الأزهر", uniEn: "Al-Azhar University Graduate", specAr: ["قراءات", "تجويد"], specEn: ["Qira'at", "Tajweed"], riwaya: "Hafs · Warsh · Qalun", exp: "15", sessions: "700+" },
  { ar: "الشيخة مريم السالم", en: "Sheikha Maryam Al-Salem", initial: "م", titleAr: "متخصصة في التفسير والتلاوة", titleEn: "Tafsir & Recitation Specialist", uniAr: "خريجة جامعة الملك سعود", uniEn: "King Saud University Graduate", specAr: ["تفسير", "تلاوة"], specEn: ["Tafsir", "Tilawa"], riwaya: "Hafs", exp: "7", sessions: "280+", noteAr: "للأخوات فقط", noteEn: "Sisters only" },
  { ar: "الشيخ أحمد البكري", en: "Sheikh Ahmed Al-Bakri", initial: "أ", titleAr: "متخصص في تعليم الأطفال", titleEn: "Children's Quran Specialist", uniAr: "خريج دار الحديث بالمدينة", uniEn: "Dar Al-Hadith, Madinah Graduate", specAr: ["حفظ", "تجويد", "أطفال"], specEn: ["Hifz", "Tajweed", "Children"], riwaya: "Hafs", exp: "9", sessions: "420+" },
];

export function TeachersContent() {
  const { t } = useLang();

  return (
    <div>
      <section className="border-b border-card-border bg-card py-20 text-center">
        <p className="text-sm text-muted"><Link href="/" className="text-gold hover:text-gold-light">{t("الرئيسية", "Home")}</Link> / {t("المعلمون", "Teachers")}</p>
        <h1 className="font-display mt-4 text-5xl font-bold">{t("معلمونا", "Our Teachers")}</h1>
      </section>

      <section className="border-b border-card-border py-8">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-center gap-8 px-6">
          {[
            { icon: Award, ar: "حاصلون على الإجازة", en: "Certified with Ijazah" },
            { icon: GraduationCap, ar: "خريجو أفضل الجامعات الإسلامية", en: "Top Islamic University Graduates" },
            { icon: Star, ar: "خبرة ٥+ سنوات في التدريس", en: "5+ Years Teaching Experience" },
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
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {TEACHERS.map((teacher) => (
              <div key={teacher.en} className="rounded-2xl border border-card-border bg-card p-6">
                <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-gold/30 bg-gold/10 font-display text-2xl font-bold text-gold">
                  {teacher.initial}
                </div>
                <h3 className="mt-4 text-lg font-bold">{t(teacher.ar, teacher.en)}</h3>
                <p className="mt-1 text-sm text-muted">{t(teacher.titleAr, teacher.titleEn)}</p>
                {teacher.noteAr && <p className="mt-1 text-xs text-gold">({t(teacher.noteAr, teacher.noteEn!)})</p>}
                <p className="mt-1 text-xs text-muted">{t(teacher.uniAr, teacher.uniEn)}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {(t(teacher.specAr.join("|||"), teacher.specEn.join("|||"))).split("|||").map((s) => (
                    <span key={s} className="rounded-full border border-card-border bg-surface px-2.5 py-0.5 text-xs text-muted">{s}</span>
                  ))}
                </div>
                <div className="mt-3 text-xs text-muted">
                  <p>{t("رواية:", "Reading:")} <span className="text-foreground">{teacher.riwaya}</span></p>
                  <p>{t(`خبرة: ${teacher.exp} سنوات`, `Experience: ${teacher.exp} years`)} · {teacher.sessions} {t("جلسة", "sessions")}</p>
                </div>
                <div className="mt-3 flex items-center gap-0.5">
                  {[1,2,3,4,5].map((i) => <Star key={i} size={12} className="fill-gold text-gold" />)}
                </div>
                <Link href="/contact" className="mt-4 block rounded border border-gold bg-gold/10 py-2 text-center text-sm font-medium text-gold transition-colors hover:bg-gold hover:text-background">
                  {t("احجز مع هذا المعلم", "Book with this Teacher")}
                </Link>
              </div>
            ))}
          </div>
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
      <FreeTrialBanner />
    </div>
  );
}
