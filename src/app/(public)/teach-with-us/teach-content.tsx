"use client";

import Link from "next/link";
import { Award, CheckCircle, GraduationCap, Users, Video } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { CONTACT } from "@/lib/contact";

export default function TeachContent() {
  const { t } = useLang();

  return (
    <div>
      <section className="islamic-pattern relative overflow-hidden pt-28 pb-20">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-background/40 via-transparent to-background" />
        <div className="relative mx-auto max-w-4xl px-6 text-center">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-gold/80">
            {t("انضم إلى فريق فرقان", "Join the FURQAN faculty")}
          </p>
          <h1 className="font-display mt-4 text-4xl font-bold leading-tight md:text-6xl lg:text-7xl">
            {t("درّس القرآن", "Teach the Quran")}
            <br />
            <span className="text-gold">{t("مع طلاب حول العالم", "To Students Worldwide")}</span>
          </h1>
          <p className="mx-auto mt-8 max-w-2xl text-lg leading-relaxed text-muted">
            {t(
              "نبحث عن معلمين ومعلمات حاصلين على الإجازة في رواية حفص وقراءات أخرى للانضمام إلى هيئة التدريس. جلسات فردية مباشرة عبر منصتنا، بجدول يناسبك، مع دعم إداري كامل.",
              "We're hiring Ijazah-certified teachers in Hafs and other readings. 1-on-1 live sessions through our platform, on a schedule that fits you, with full admin support.",
            )}
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <a
              href="/teach/apply"
              className="glass-gold glass-pill flex items-center justify-center gap-2 px-10 py-4 text-lg font-bold transition-colors duration-200 hover:bg-gold-hover"
            >
              {t("التقديم عبر النموذج", "Apply via form")}
            </a>
            <a
              href={CONTACT.whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="glass-pill flex items-center justify-center gap-2 px-8 py-3 text-base font-medium text-muted transition-colors hover:text-gold"
            >
              {t("أو عبر واتساب", "Or via WhatsApp")}
            </a>
            <a
              href={CONTACT.emailUrl}
              className="inline-flex items-center gap-1.5 text-base text-muted transition-colors hover:text-gold"
            >
              {t("أو راسلنا عبر البريد", "Or email us")}
              <span aria-hidden>→</span>
            </a>
          </div>
        </div>
      </section>

      <section className="section-light py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="text-center">
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-gold/80">
              {t("لماذا التدريس معنا", "Why teach with us")}
            </p>
            <h2 className="font-display mt-3 text-3xl font-bold leading-tight md:text-4xl">
              {t("عمل مُثمر بأدوات حديثة", "Rewarding work, modern tools")}
            </h2>
          </div>

          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                icon: Users,
                ar: "طلاب جاهزون",
                en: "Students ready to learn",
                dAr: "نوفر لك الطلاب — بدون حاجة للبحث أو التسويق.",
                dEn: "We bring you students — no need to market yourself.",
              },
              {
                icon: Video,
                ar: "منصة متكاملة",
                en: "Integrated platform",
                dAr: "فيديو مدمج وتتبع للحفظ وأدوات تصحيح المتابعات.",
                dEn: "Built-in video, memorization tracking, and follow-up grading.",
              },
              {
                icon: GraduationCap,
                ar: "جدول مرن",
                en: "Flexible schedule",
                dAr: "أنت تحدد ساعات توفرك. نحن ننسّق الحجوزات.",
                dEn: "You set your availability. We handle the bookings.",
              },
              {
                icon: Award,
                ar: "دفع عادل ومنتظم",
                en: "Fair, regular payouts",
                dAr: "دفعات أسبوعية واضحة ومباشرة.",
                dEn: "Clear weekly payouts, direct to you.",
              },
              {
                icon: CheckCircle,
                ar: "دعم إداري",
                en: "Admin support",
                dAr: "فريق يساعدك في الحالات الخاصة والمتابعة.",
                dEn: "A team that handles escalations and follow-up for you.",
              },
              {
                icon: Users,
                ar: "مجتمع معلمين",
                en: "Teacher community",
                dAr: "تواصل مع معلمين آخرين لتبادل الخبرات.",
                dEn: "Connect with other teachers and share practice.",
              },
            ].map((b) => (
              <div
                key={b.en}
                className="rounded-2xl border border-surface-border/60 bg-surface/40 p-5 transition-colors duration-200 hover:border-gold/30"
              >
                <b.icon size={20} className="mb-3 text-foreground/70" strokeWidth={1.75} />
                <h3 className="text-sm font-bold">{t(b.ar, b.en)}</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted">{t(b.dAr, b.dEn)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-24">
        <div className="mx-auto max-w-3xl px-6">
          <div className="text-center">
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-gold/80">
              {t("ما نبحث عنه", "What we look for")}
            </p>
            <h2 className="font-display mt-3 text-3xl font-bold leading-tight md:text-4xl">
              {t("المتطلبات الأساسية", "Core requirements")}
            </h2>
          </div>

          <ul className="mt-10 space-y-3">
            {[
              {
                ar: "إجازة صحيحة في رواية حفص عن عاصم (أو قراءة أخرى)",
                en: "Valid Ijazah in Hafs 'an Asim (or another reading)",
              },
              {
                ar: "خبرة تدريسية لا تقل عن سنتين",
                en: "At least two years of teaching experience",
              },
              { ar: "اتصال إنترنت مستقر وميكروفون نظيف", en: "Stable internet and a clean microphone" },
              { ar: "التزام بالمواعيد واحترام الطلاب وأولياء الأمور", en: "Punctuality and respect for students and parents" },
              {
                ar: "إتقان العربية. الإنجليزية أو لغات أخرى ميزة إضافية.",
                en: "Fluent Arabic. English or other languages a plus.",
              },
            ].map((r) => (
              <li
                key={r.en}
                className="flex items-start gap-3 rounded-xl border border-surface-border/60 bg-surface/40 px-5 py-4"
              >
                <CheckCircle size={18} className="mt-0.5 text-gold shrink-0" />
                <span className="text-sm leading-relaxed">{t(r.ar, r.en)}</span>
              </li>
            ))}
          </ul>

          <div className="mt-12 text-center">
            <a
              href={CONTACT.whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="glass-gold glass-pill inline-flex items-center justify-center gap-2 px-10 py-4 text-lg font-bold transition-colors duration-200 hover:bg-gold-hover"
            >
              {t("قدّم الآن", "Apply now")}
            </a>
            <p className="mt-4 text-sm text-muted">
              {t("سنرد عادةً خلال ٤٨ ساعة", "We usually respond within 48 hours")}
              {" · "}
              <Link href="/contact" className="text-gold hover:text-gold-light">
                {t("أو افتح نموذج الاتصال", "Or open the contact form")}
              </Link>
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
