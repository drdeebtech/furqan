"use client";

import Link from "next/link";
import Image from "next/image";
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
import { Testimonials } from "@/components/public/testimonials";
import { RegisterBanner } from "@/components/public/register-banner";

export default function HomePage() {
  const { t } = useLang();

  return (
    <div>
      {/* ══════════════════════════════════════════
          HERO — Islamic pattern bg + radial glow
          ══════════════════════════════════════════ */}
      <section className="islamic-pattern relative min-h-[90vh] overflow-hidden pt-28 pb-24">
        {/* Layered background effects */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-background/60 via-transparent to-background" />
        <div className="pointer-events-none absolute left-1/2 top-1/4 h-[600px] w-[600px] -translate-x-1/2 rounded-full bg-gold/8 blur-[120px]" />
        <div className="pointer-events-none absolute right-0 top-0 h-[300px] w-[300px] rounded-full bg-gold/5 blur-[80px]" />

        <div className="relative mx-auto max-w-5xl px-6">
          <div className="text-center">
            {/* Badge */}
            <div className="mb-8 inline-flex items-center gap-3 rounded-full border border-gold/30 bg-gold/10 px-5 py-2 text-sm">
              <span className="h-2 w-2 animate-pulse rounded-full bg-gold" />
              <span className="text-gold">{t("✦ أكاديمية القرآن الكريم عبر الإنترنت", "✦ Online Quran Learning Academy")}</span>
            </div>

            {/* Logo */}
            <div className="mb-6 flex justify-center">
              <Image src="/logo-192.png" alt="فرقان" width={80} height={80} className="rounded-full border-2 border-gold/30" priority />
            </div>

            {/* Heading */}
            <h1 className="font-display text-5xl font-bold leading-[1.15] md:text-7xl lg:text-8xl">
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

            {/* CTA buttons — full-width on mobile, prominent */}
            <div className="mt-10 flex w-full flex-col items-center gap-4 px-4 sm:w-auto sm:flex-row sm:justify-center sm:px-0">
              <Link
                href="/register"
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gold px-10 py-4 text-lg font-bold text-background shadow-lg shadow-gold/20 transition-all hover:bg-gold-hover hover:shadow-xl hover:shadow-gold/30 sm:w-auto animate-pulse-slow"
              >
                <Play size={20} />
                {t("سجّل الآن", "Register Now")}
              </Link>
              <Link
                href="/services"
                className="w-full rounded-xl border-2 border-card-border px-8 py-4 text-center text-lg text-muted transition-colors hover:border-gold/40 hover:text-gold sm:w-auto"
              >
                {t("تعرف على خدماتنا", "Explore Our Services")}
              </Link>
            </div>

            {/* Trust micro-copy */}
            <div className="mt-6 flex flex-wrap justify-center gap-4 text-sm text-muted">
              <span className="flex items-center gap-1"><CheckCircle size={14} className="text-gold" /> {t("التسجيل مجاني", "Free registration")}</span>
              <span className="flex items-center gap-1"><CheckCircle size={14} className="text-gold" /> {t("معلمون معتمدون", "Certified teachers")}</span>
              <span className="flex items-center gap-1"><CheckCircle size={14} className="text-gold" /> {t("إلغاء في أي وقت", "Cancel anytime")}</span>
            </div>
          </div>

          {/* ── STATS — with gold shimmer effect ── */}
          <div className="mt-16 grid grid-cols-3 gap-4 md:gap-6">
            {[
              { num: t("٢٤/٧", "24/7"), label: t("متاح على مدار الساعة", "Available Anytime"), icon: Users },
              { num: t("١:١", "1:1"), label: t("جلسات فردية مباشرة", "Live Private Sessions"), icon: Star },
              { num: t("إجازة", "Ijazah"), label: t("معلمون حاصلون على الإجازة", "Certified Teachers"), icon: GraduationCap },
            ].map((s) => (
              <div key={s.label} className="rounded-2xl border border-gold/20 bg-card/80 p-6 text-center backdrop-blur-sm">
                <s.icon size={24} className="mx-auto mb-2 text-gold" />
                <p className="stat-shimmer text-3xl font-bold md:text-4xl">{s.num}</p>
                <p className="mt-1 text-sm text-muted">{s.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom fade into next section */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-background to-transparent" />
      </section>

      {/* ── ORNAMENTAL DIVIDER ── */}
      <div className="ornament-divider py-4">
        <span className="text-gold/40">✦</span>
      </div>

      {/* ══════════════════════════════════════════
          HOW IT WORKS — alternating bg
          ══════════════════════════════════════════ */}
      <section className="section-light py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="text-center">
            <p className="text-sm font-medium tracking-widest text-gold">❖ {t("كيف يعمل", "How It Works")}</p>
            <h2 className="font-display mt-3 text-4xl font-bold">{t("ابدأ في ٣ خطوات بسيطة", "Start in 3 Simple Steps")}</h2>
          </div>

          <div className="mt-16 grid gap-8 md:grid-cols-3">
            {[
              { num: "01", icon: Users, ar: "سجّل حسابك", en: "Create Account", dAr: "أنشئ حسابك وابدأ التعلم", dEn: "Create your account and start learning" },
              { num: "02", icon: Calendar, ar: "اختر معلمك", en: "Choose Teacher", dAr: "تصفح المعلمين المعتمدين واختر الأنسب لمستواك وأهدافك.", dEn: "Browse certified teachers and pick the best match for your level and goals." },
              { num: "03", icon: Video, ar: "ابدأ التعلم", en: "Start Learning", dAr: "انضم لجلستك عبر الفيديو المدمج وتابع تقدمك في الحفظ.", dEn: "Join your session via built-in video and track your memorization progress." },
            ].map((step) => (
              <div key={step.num} className="group relative rounded-2xl border border-card-border bg-card p-8 transition-all hover:border-gold/30 hover:shadow-lg hover:shadow-gold/5">
                <span className="absolute -top-4 right-6 rounded-full bg-gold px-3 py-1 text-sm font-bold text-background">{step.num}</span>
                <step.icon size={32} className="mb-4 text-gold transition-transform group-hover:scale-110" />
                <h3 className="text-lg font-bold">{t(step.ar, step.en)}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{t(step.dAr, step.dEn)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          WHY FURQAN — warm accent background
          ══════════════════════════════════════════ */}
      <section className="section-accent islamic-pattern relative py-24">
        <div className="pointer-events-none absolute inset-0 bg-background/80" />
        <div className="relative mx-auto max-w-7xl px-6">
          <div className="text-center">
            <p className="text-sm font-medium tracking-widest text-gold">❖ {t("لماذا فرقان", "Why FURQAN")}</p>
            <h2 className="font-display mt-3 text-4xl font-bold">{t("لماذا تختار فرقان؟", "Why Choose FURQAN?")}</h2>
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
              { icon: Award, ar: "سجّل واحجز جلستك", en: "Register & Book Your Session", dAr: "سجّل الآن وابدأ رحلتك مع القرآن", dEn: "Register now and start your Quran journey" },
            ].map((f) => (
              <div key={f.en} className="rounded-xl border border-card-border bg-card/90 p-5 backdrop-blur-sm transition-all hover:border-gold/30 hover:-translate-y-1">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-gold/10">
                  <f.icon size={20} className="text-gold" />
                </div>
                <h3 className="text-sm font-bold">{t(f.ar, f.en)}</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted">{t(f.dAr, f.dEn)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── ORNAMENTAL DIVIDER ── */}
      <div className="ornament-divider py-4">
        <span className="text-gold/40">✦</span>
      </div>

      {/* ══════════════════════════════════════════
          COURSES — clean section
          ══════════════════════════════════════════ */}
      <section className="py-24">
        <div className="mx-auto max-w-7xl px-6">
          <p className="text-sm font-medium tracking-widest text-gold">❖ {t("التخصصات", "Courses")}</p>
          <h2 className="font-display mt-3 text-4xl font-bold">{t("ما نُعلّمه في فرقان", "What We Teach at FURQAN")}</h2>

          <div className="mt-12 grid grid-cols-2 gap-4 md:grid-cols-3">
            {[
              { ar: "حفظ القرآن", en: "Quran Memorization", dAr: "احفظ كتاب الله مع معلم متخصص بمنهج تدريجي", dEn: "Memorize the Quran with a specialist teacher", icon: BookOpen },
              { ar: "التجويد", en: "Tajweed", dAr: "أتقن أحكام التلاوة بأسلوب علمي ممنهج", dEn: "Master recitation rules with a structured approach", icon: CheckCircle },
              { ar: "المراجعة", en: "Revision", dAr: "راجع محفوظاتك مع معلم يتابع تقدمك", dEn: "Review memorization with progress tracking", icon: TrendingUp },
              { ar: "التلاوة", en: "Recitation", dAr: "حسّن أداءك مع شيخ متخصص في المقامات", dEn: "Improve recitation with a specialized sheikh", icon: Star },
              { ar: "القراءات", en: "Qira'at", dAr: "تعلّم روايات حفص وورش وقالون والدوري", dEn: "Learn readings: Hafs, Warsh, Qalun, Al-Duri", icon: Globe },
              { ar: "التفسير", en: "Tafsir", dAr: "افهم معاني القرآن وتدبّر آياته", dEn: "Understand Quran meanings and reflect", icon: Award },
            ].map((c) => (
              <Link key={c.en} href="/services" className="group rounded-xl border border-card-border bg-card p-6 transition-all hover:border-gold/30 hover:shadow-lg hover:shadow-gold/5">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-gold/10 transition-colors group-hover:bg-gold/20">
                  <c.icon size={20} className="text-gold" />
                </div>
                <h3 className="font-bold text-gold">{t(c.ar, c.en)}</h3>
                <p className="mt-2 text-xs leading-relaxed text-muted">{t(c.dAr, c.dEn)}</p>
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
          TRUST BADGES — certification bar
          ══════════════════════════════════════════ */}
      <section className="border-y border-gold/10 bg-gold/5 py-8">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-8 px-6">
          {[
            { icon: GraduationCap, ar: "خريجو جامعة الأزهر", en: "Al-Azhar Graduates" },
            { icon: Shield, ar: "إجازة في رواية حفص", en: "Hafs Ijazah Certified" },
            { icon: Globe, ar: "متاح لطلاب حول العالم", en: "Available Worldwide" },
            { icon: Award, ar: "سجّل مجاناً", en: "Free Registration" },
          ].map((b) => (
            <div key={b.en} className="flex items-center gap-2 text-sm">
              <b.icon size={18} className="text-gold" />
              <span className="text-foreground">{t(b.ar, b.en)}</span>
            </div>
          ))}
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
            <p className="text-sm font-medium tracking-widest text-gold">❖ {t("الباقات", "Packages")}</p>
            <h2 className="font-display mt-3 text-4xl font-bold">{t("باقاتنا", "Our Packages")}</h2>
          </div>

          <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {[
              { ar: "الباقة الأساسية", en: "Starter", freq: t("٢ أيام/أسبوع · ٨ جلسات", "2 days/week · 8 sessions") },
              { ar: "الباقة المتوسطة", en: "Standard", freq: t("٣ أيام/أسبوع · ١٢ جلسة", "3 days/week · 12 sessions") },
              { ar: "الباقة المتقدمة", en: "Premium", freq: t("٥ أيام/أسبوع · ٢٠ جلسة", "5 days/week · 20 sessions"), featured: true },
              { ar: "باقة نهاية الأسبوع", en: "Weekend", freq: t("السبت والأحد · ٨ جلسات", "Sat & Sun · 8 sessions") },
            ].map((p) => (
              <div key={p.en} className={`rounded-2xl p-6 transition-all hover:-translate-y-1 ${p.featured ? "border-2 border-gold bg-card shadow-lg shadow-gold/10" : "border border-card-border bg-card"}`}>
                {p.featured && <span className="mb-3 inline-block rounded-full bg-gold px-3 py-1 text-xs font-bold text-background">{t("الأكثر طلباً", "Most Popular")}</span>}
                <h3 className="text-lg font-bold">{t(p.ar, p.en)}</h3>
                <p className="font-display mt-2 text-2xl font-bold text-gold">{t("مجاناً", "Free")}</p>
                <p className="mt-1 text-xs text-muted">{p.freq}</p>
                <Link href="/packages" className="mt-4 block rounded-lg border border-gold bg-gold/10 py-2.5 text-center text-sm font-medium text-gold transition-colors hover:bg-gold hover:text-background">
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
