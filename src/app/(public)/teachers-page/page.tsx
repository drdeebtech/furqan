import type { Metadata } from "next";
import Link from "next/link";
import { Award, GraduationCap, Star } from "lucide-react";
import { Testimonials } from "@/components/public/testimonials";
import { FreeTrialBanner } from "@/components/public/free-trial-banner";

export const metadata: Metadata = { title: "معلمونا" };

const TEACHERS = [
  { name: "الشيخ محمد العمري", initial: "م", title: "متخصص في الحفظ والتجويد", uni: "خريج جامعة الأزهر الشريف", spec: ["حفظ", "تجويد", "مراجعة"], riwaya: "حفص عن عاصم", exp: "١٠ سنوات", sessions: "٥٠٠+", langs: "العربية · English" },
  { name: "الشيخة أمينة الشريف", initial: "أ", title: "متخصصة في تعليم الأطفال والأخوات", uni: "خريجة جامعة أم القرى", spec: ["تجويد", "تلاوة", "أطفال"], riwaya: "حفص عن عاصم", exp: "٨ سنوات", sessions: "٣٥٠+", langs: "العربية · English", note: "للأخوات والأطفال فقط" },
  { name: "الشيخ عبدالرحمن فارس", initial: "ع", title: "متخصص في الحفظ والمراجعة", uni: "خريج الجامعة الإسلامية بالمدينة", spec: ["حفظ", "مراجعة"], riwaya: "حفص عن عاصم", exp: "١٢ سنة", sessions: "٦٠٠+", langs: "العربية · English · Urdu" },
  { name: "الشيخ يوسف الحسني", initial: "ي", title: "متخصص في القراءات", uni: "خريج جامعة الأزهر", spec: ["قراءات", "تجويد"], riwaya: "حفص · ورش · قالون", exp: "١٥ سنة", sessions: "٧٠٠+", langs: "العربية · English · Français" },
  { name: "الشيخة مريم السالم", initial: "م", title: "متخصصة في التفسير والتلاوة", uni: "خريجة جامعة الملك سعود", spec: ["تفسير", "تلاوة"], riwaya: "حفص عن عاصم", exp: "٧ سنوات", sessions: "٢٨٠+", langs: "العربية · English", note: "للأخوات فقط" },
  { name: "الشيخ أحمد البكري", initial: "أ", title: "متخصص في تعليم الأطفال", uni: "خريج دار الحديث بالمدينة", spec: ["حفظ", "تجويد", "أطفال"], riwaya: "حفص عن عاصم", exp: "٩ سنوات", sessions: "٤٢٠+", langs: "العربية · English" },
];

export default function TeachersPage() {
  return (
    <div dir="rtl">
      <section className="border-b border-card-border bg-card py-20 text-center">
        <p className="text-sm text-muted">
          <Link href="/" className="text-gold hover:text-gold-light">الرئيسية</Link> / المعلمون
        </p>
        <h1 className="font-display mt-4 text-5xl font-bold">معلمونا</h1>
        <p className="mt-2 text-muted">Our Teachers</p>
      </section>

      {/* Trust badges */}
      <section className="border-b border-card-border py-8">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-center gap-8 px-6">
          {[
            { icon: Award, text: "حاصلون على الإجازة" },
            { icon: GraduationCap, text: "خريجو أفضل الجامعات الإسلامية" },
            { icon: Star, text: "خبرة ٥+ سنوات في التدريس" },
          ].map((b) => (
            <div key={b.text} className="flex items-center gap-2 text-sm text-muted">
              <b.icon size={18} className="text-gold" />
              {b.text}
            </div>
          ))}
        </div>
      </section>

      {/* Teacher profiles */}
      <section className="py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {TEACHERS.map((t) => (
              <div key={t.name} className="rounded-2xl border border-card-border bg-card p-6">
                <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-gold/30 bg-gold/10 font-display text-2xl font-bold text-gold">
                  {t.initial}
                </div>
                <h3 className="mt-4 text-lg font-bold">{t.name}</h3>
                <p className="mt-1 text-sm text-muted">{t.title}</p>
                {t.note && <p className="mt-1 text-xs text-gold">({t.note})</p>}
                <p className="mt-1 text-xs text-muted">{t.uni}</p>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {t.spec.map((s) => (
                    <span key={s} className="rounded-full border border-card-border bg-surface px-2.5 py-0.5 text-xs text-muted">{s}</span>
                  ))}
                </div>

                <div className="mt-3 text-xs text-muted">
                  <p>رواية: <span className="text-foreground">{t.riwaya}</span></p>
                  <p>خبرة: {t.exp} · {t.sessions} جلسة</p>
                  <p>{t.langs}</p>
                </div>

                <div className="mt-3 flex items-center gap-0.5">
                  {[1,2,3,4,5].map((i) => <Star key={i} size={12} className="fill-gold text-gold" />)}
                </div>

                <Link
                  href="/contact"
                  className="mt-4 block rounded border border-gold bg-gold/10 py-2 text-center text-sm font-medium text-gold transition-colors hover:bg-gold hover:text-background"
                >
                  احجز مع هذا المعلم
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Hiring */}
      <section className="border-t border-card-border bg-card/30 py-16">
        <div className="mx-auto max-w-2xl px-6 text-center">
          <h2 className="font-display text-2xl font-bold">هل أنت معلم قرآن متخصص؟</h2>
          <p className="mt-2 text-sm text-muted">انضم إلى فريقنا وساهم في تعليم القرآن للمسلمين حول العالم</p>
          <Link href="/contact?type=teacher" className="mt-6 inline-block rounded border border-gold bg-gold/10 px-6 py-2.5 text-sm font-medium text-gold transition-colors hover:bg-gold hover:text-background">
            تقدم الآن
          </Link>
        </div>
      </section>

      <div className="border-t border-card-border"><Testimonials /></div>
      <FreeTrialBanner />
    </div>
  );
}
