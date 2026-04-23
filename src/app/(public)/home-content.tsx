"use client";

import Link from "next/link";
import Image from "next/image";
import dynamic from "next/dynamic";
import {
  Award,
  BookOpen,
  Calendar,
  CheckCircle,
  Globe,
  GraduationCap,
  Play,
  Shield,
  Star,
  TrendingUp,
  Users,
  Video,
} from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { RegisterBanner } from "@/components/public/register-banner";

const Testimonials = dynamic(
  () => import("@/components/public/testimonials").then((m) => m.Testimonials),
);

export default function HomePage() {
  const { t } = useLang();

  return (
    <div>
      {/* ══════════════════════════════════════════
          HERO — Islamic pattern, ornament-free
          ══════════════════════════════════════════ */}
      <section className="islamic-pattern relative min-h-[85vh] overflow-hidden pt-28 pb-24">
        {/* Soft top-to-bottom fade only — no radial glow */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-background/40 via-transparent to-background" />

        <div className="relative mx-auto max-w-5xl px-6">
          <div className="text-center">
            {/* Badge */}
            <div className="glass glass-pill mb-8 inline-flex items-center gap-2 px-4 py-1.5 text-xs">
              <span className="text-gold">{t("أكاديمية القرآن الكريم عبر الإنترنت", "Online Quran Learning Academy")}</span>
            </div>

            {/* Logo */}
            <div className="mb-6 flex justify-center">
              <Image src="/logo-192.png" alt="فرقان" width={80} height={80} className="rounded-full border-2 border-gold/30" priority />
            </div>

            {/* Heading */}
            <h1 className="font-display text-4xl font-bold leading-[1.15] md:text-6xl lg:text-7xl">
              {t("تعلّم", "Learn")}{" "}
              <span className="text-gold">{t("القرآن", "Quran")}</span>
              <br />
              {t("مع أمهر المعلمين", "With Expert Teachers")}
            </h1>

            {/* Subtitle */}
            <p className="mx-auto mt-8 max-w-2xl text-lg leading-relaxed text-muted md:text-xl">
              {t(
                "معلمون حاصلون على الإجازة · جلسات فيديو مباشرة · جدول يناسبك · من أي مكان في العالم",
                "Certified teachers with Ijazah · Live video sessions · Flexible schedule · From anywhere in the world",
              )}
            </p>

            {/* CTA buttons — primary filled, secondary text link */}
            <div className="mt-10 flex w-full flex-col items-center gap-4 px-4 sm:w-auto sm:flex-row sm:justify-center sm:px-0">
              <Link
                href="/register"
                className="glass-gold glass-pill flex w-full items-center justify-center gap-2 px-10 py-4 text-lg font-bold transition-all duration-200 hover:bg-gold-hover sm:w-auto"
              >
                <Play size={18} />
                {t("سجّل الآن", "Register Now")}
              </Link>
              <Link
                href="/services"
                className="inline-flex items-center gap-1.5 text-base text-muted transition-colors hover:text-gold sm:w-auto"
              >
                {t("تعرف على خدماتنا", "Explore our services")}
                <span aria-hidden>→</span>
              </Link>
            </div>

          </div>

          {/* ── Trust strip — honest descriptors, not fake stats ── */}
          <div className="mt-12 grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
            {[
              { label: t("جلسات فردية ١:١", "1-on-1 live sessions"), icon: Users },
              { label: t("معلمون حاصلون على الإجازة", "Ijazah-certified teachers"), icon: GraduationCap },
              { label: t("جدول يناسبك · ٧ أيام", "Flexible schedule · 7 days"), icon: Star },
            ].map((s) => (
              <div key={s.label} className="flex items-center justify-center gap-3 rounded-xl border border-surface-border/60 bg-surface/40 px-5 py-4 text-sm">
                <s.icon size={18} className="text-gold shrink-0" />
                <span className="text-foreground">{s.label}</span>
              </div>
            ))}
          </div>

          {/* ── Hero-level social proof — one strong testimonial ── */}
          <figure className="mx-auto mt-10 max-w-2xl rounded-2xl border border-surface-border/60 bg-surface/40 px-6 py-5">
            <blockquote className="text-base leading-relaxed text-foreground">
              {t(
                "«أتممتُ حفظ جزء عمّ في ثلاثة أشهر فقط بفضل الله ثم بفضل معلمتي الرائعة.»",
                "“I completed memorizing Juz Amma in just three months, by the grace of Allah and my wonderful teacher.”",
              )}
            </blockquote>
            <figcaption className="mt-3 flex items-center gap-2 text-xs text-muted">
              <span className="font-medium text-foreground">{t("فاطمة السيد", "Fatima Al-Sayed")}</span>
              <span className="text-muted">·</span>
              <span>{t("الكويت 🇰🇼", "Kuwait 🇰🇼")}</span>
            </figcaption>
          </figure>
        </div>

        {/* Bottom fade into next section */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-background to-transparent" />
      </section>

      {/* ══════════════════════════════════════════
          HOW IT WORKS — alternating bg
          ══════════════════════════════════════════ */}
      <section className="section-light py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="text-center">
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-gold/80">{t("كيف يعمل", "How it works")}</p>
            <h2 className="font-display mt-3 text-4xl font-bold leading-tight">{t("ابدأ في ٣ خطوات بسيطة", "Start in 3 Simple Steps")}</h2>
          </div>

          {/* Horizontal journey flow — dashed connector between large numbered steps.
              On mobile collapses to a stacked vertical path with a left-side rail. */}
          <div className="mt-16">
            <ol className="relative mx-auto grid max-w-4xl gap-10 md:grid-cols-3 md:gap-6">
              {/* Desktop connector rail — sits behind the number medallions */}
              <div
                aria-hidden
                className="pointer-events-none absolute left-0 right-0 top-8 hidden h-px border-t border-dashed border-gold/25 md:block"
              />
              {[
                { num: "١", en_num: "1", icon: Users, ar: "سجّل حسابك", en: "Create Account", dAr: "أنشئ حسابك مجاناً في أقل من دقيقة.", dEn: "Create your free account in under a minute." },
                { num: "٢", en_num: "2", icon: Calendar, ar: "اختر معلمك", en: "Choose Teacher", dAr: "تصفح المعلمين المعتمدين واختر الأنسب لمستواك.", dEn: "Browse certified teachers and pick the best match." },
                { num: "٣", en_num: "3", icon: Video, ar: "ابدأ التعلم", en: "Start Learning", dAr: "انضم لجلستك المباشرة عبر الفيديو المدمج.", dEn: "Join your live session via the built-in video." },
              ].map((step) => (
                <li key={step.en_num} className="relative flex flex-col items-center text-center">
                  {/* Number medallion — solid gold, sits on the rail */}
                  <div className="relative z-10 flex h-16 w-16 items-center justify-center rounded-full bg-gold font-display text-2xl font-bold text-background shadow-md">
                    {t(step.num, step.en_num)}
                  </div>
                  <step.icon size={22} className="mt-5 text-gold/70" />
                  <h3 className="mt-3 text-lg font-bold">{t(step.ar, step.en)}</h3>
                  <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted">{t(step.dAr, step.dEn)}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          WHY FURQAN — warm accent background
          ══════════════════════════════════════════ */}
      <section className="section-accent islamic-pattern relative py-24">
        <div className="pointer-events-none absolute inset-0 bg-background/40" />
        <div className="relative mx-auto max-w-7xl px-6">
          <div className="text-center">
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-gold/80">{t("لماذا فرقان", "Why Furqan")}</p>
            <h2 className="font-display mt-3 text-4xl font-bold leading-tight">{t("لماذا تختار فرقان؟", "Why Choose FURQAN?")}</h2>
          </div>

          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { icon: Shield, ar: "معلمون معتمدون بالإجازة", en: "Certified with Ijazah", dAr: "جميع معلمينا حاصلون على إجازة من كبار العلماء", dEn: "All teachers hold Ijazah from senior scholars" },
              { icon: Video, ar: "جلسات فيديو مدمجة", en: "Built-in Video", dAr: "لا حاجة لزوم أو سكايب — الفيديو مدمج في المنصة", dEn: "No Zoom or Skype — video is built into the platform" },
              { icon: Calendar, ar: "جدول مرن يناسبك", en: "Flexible Schedule", dAr: "احجز في أي وقت — صباحاً أو مساءً، ٧ أيام", dEn: "Book any time — morning or evening, 7 days a week" },
              { icon: Users, ar: "جلسات فردية ١:١", en: "1-on-1 Sessions", dAr: "كل طالب يحصل على اهتمام كامل من معلمه", dEn: "Every student gets full attention from their teacher" },
              { icon: Star, ar: "معلمات للأخوات والأطفال", en: "Female Teachers", dAr: "متاح معلمات متخصصات في بيئة آمنة", dEn: "Female teachers available for sisters and children" },
              { icon: TrendingUp, ar: "تتبع تقدمك", en: "Track Progress", dAr: "لوحة تحكم تعرض تقدمك في الحفظ والجلسات", dEn: "Dashboard showing your memorization progress" },
              { icon: Globe, ar: "نخدم طلاباً حول العالم", en: "Worldwide Access", dAr: "تعلّم من أي مكان — أمريكا، أوروبا، الخليج، أستراليا", dEn: "Learn from anywhere — USA, Europe, Gulf, Australia" },
            ].map((f) => (
              <div key={f.en} className="rounded-2xl border border-surface-border/60 bg-surface/40 p-5 transition-colors duration-200 hover:border-gold/30">
                <f.icon size={20} className="mb-3 text-foreground/70" strokeWidth={1.75} />
                <h3 className="text-sm font-bold">{t(f.ar, f.en)}</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted">{t(f.dAr, f.dEn)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          COURSES — clean section
          ══════════════════════════════════════════ */}
      <section className="py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="text-center">
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-gold/80">{t("التخصصات", "Courses")}</p>
            <h2 className="font-display mt-3 text-4xl font-bold leading-tight">{t("ما نُعلّمه في فرقان", "What We Teach at FURQAN")}</h2>
          </div>

          <div className="mt-12 grid grid-cols-2 gap-4 md:grid-cols-3">
            {[
              { ar: "حفظ القرآن", en: "Quran Memorization", dAr: "احفظ كتاب الله مع معلم متخصص بمنهج تدريجي", dEn: "Memorize the Quran with a specialist teacher", icon: BookOpen },
              { ar: "التجويد", en: "Tajweed", dAr: "أتقن أحكام التلاوة بأسلوب علمي ممنهج", dEn: "Master recitation rules with a structured approach", icon: CheckCircle },
              { ar: "المراجعة", en: "Revision", dAr: "راجع محفوظاتك مع معلم يتابع تقدمك", dEn: "Review memorization with progress tracking", icon: TrendingUp },
              { ar: "التلاوة", en: "Recitation", dAr: "حسّن أداءك مع شيخ متخصص في المقامات", dEn: "Improve recitation with a specialized sheikh", icon: Star },
              { ar: "القراءات", en: "Qira'at", dAr: "تعلّم روايات حفص وورش وقالون والدوري", dEn: "Learn readings: Hafs, Warsh, Qalun, Al-Duri", icon: Globe },
              { ar: "التفسير", en: "Tafsir", dAr: "افهم معاني القرآن وتدبّر آياته", dEn: "Understand Quran meanings and reflect", icon: Award },
            ].map((c) => (
              <Link key={c.en} href="/services" className="rounded-2xl border border-surface-border/60 bg-surface/40 p-5 transition-colors duration-200 hover:border-gold/30">
                <c.icon size={20} className="mb-3 text-foreground/70" strokeWidth={1.75} />
                <h3 className="text-sm font-bold">{t(c.ar, c.en)}</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted">{t(c.dAr, c.dEn)}</p>
              </Link>
            ))}
          </div>

          <div className="mt-8 text-center">
            <Link href="/services" className="text-sm font-medium text-gold transition-colors hover:text-gold-light">
              {t("عرض جميع الخدمات ←", "View All Services →")}
            </Link>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          CREDENTIALS — scholar certification bar
          (distinct from hero trust strip — this is
          about institutional authority, not product)
          ══════════════════════════════════════════ */}
      <section className="border-y border-surface-border/60 bg-surface/30 py-10">
        <div className="mx-auto max-w-5xl px-6">
          <p className="text-center text-xs font-medium uppercase tracking-[0.2em] text-muted">
            {t("الاعتمادات العلمية", "Scholarly credentials")}
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
            {[
              { icon: GraduationCap, ar: "خريجو جامعة الأزهر", en: "Al-Azhar Graduates" },
              { icon: Shield, ar: "إجازة في رواية حفص", en: "Hafs Ijazah Certified" },
              { icon: Globe, ar: "طلاب من ٣٠+ دولة", en: "Students from 30+ countries" },
            ].map((b) => (
              <div key={b.en} className="flex items-center gap-2 text-sm">
                <b.icon size={18} className="text-foreground/70" strokeWidth={1.75} />
                <span className="text-foreground">{t(b.ar, b.en)}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          TESTIMONIALS — with pattern bg
          ══════════════════════════════════════════ */}
      <div className="section-light">
        <Testimonials />
      </div>

      {/* ══════════════════════════════════════════
          PACKAGES PREVIEW
          ══════════════════════════════════════════ */}
      <section className="py-24">
        <div className="mx-auto max-w-5xl px-6">
          <div className="text-center">
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-gold/80">{t("الباقات", "Packages")}</p>
            <h2 className="font-display mt-3 text-4xl font-bold leading-tight">{t("باقاتنا", "Our Packages")}</h2>
            <p className="mx-auto mt-3 max-w-xl text-sm text-muted">
              {t(
                "ابدأ بجلسة تجريبية مجانية، ثم اختر الباقة التي تناسبك.",
                "Start with a free trial session, then choose the plan that fits.",
              )}
            </p>
          </div>

          <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {[
              { ar: "الباقة الأساسية", en: "Starter", freq: t("٢ أيام/أسبوع · ٨ جلسات", "2 days/week · 8 sessions") },
              { ar: "الباقة المتوسطة", en: "Standard", freq: t("٣ أيام/أسبوع · ١٢ جلسة", "3 days/week · 12 sessions") },
              { ar: "الباقة المتقدمة", en: "Premium", freq: t("٥ أيام/أسبوع · ٢٠ جلسة", "5 days/week · 20 sessions"), featured: true },
              { ar: "باقة نهاية الأسبوع", en: "Weekend", freq: t("السبت والأحد · ٨ جلسات", "Sat & Sun · 8 sessions") },
            ].map((p) => (
              <div key={p.en} className={`glass-card p-6 transition-all duration-200 ${p.featured ? "border-2 border-gold" : ""}`}>
                {p.featured && <span className="glass-gold glass-pill mb-3 inline-block px-3 py-1 text-xs font-bold">{t("الأكثر طلباً", "Most Popular")}</span>}
                <h3 className="text-lg font-bold">{t(p.ar, p.en)}</h3>
                <p className="mt-2 text-sm text-muted">{p.freq}</p>
                <p className="mt-3 text-sm text-gold">{t("تواصل معنا للتسعير", "Contact us for pricing")}</p>
                <Link href="/packages" className="glass glass-pill mt-4 block py-2.5 text-center text-sm font-medium text-gold transition-colors duration-200 hover:bg-gold hover:text-background">
                  {t("التفاصيل", "View Details")}
                </Link>
              </div>
            ))}
          </div>

          <div className="mt-8 text-center">
            <Link href="/packages" className="text-sm font-medium text-gold transition-colors hover:text-gold-light">
              {t("عرض جميع الباقات ←", "View All Packages →")}
            </Link>
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ── */}
      <RegisterBanner />
    </div>
  );
}
