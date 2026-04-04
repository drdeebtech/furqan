"use client";

import Link from "next/link";
import {
  Award,
  BookOpen,
  Calendar,
  CheckCircle,
  Globe,
  Shield,
  Star,
  TrendingUp,
  Users,
  Video,
} from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { Testimonials } from "@/components/public/testimonials";
import { FreeTrialBanner } from "@/components/public/free-trial-banner";

export default function HomePage() {
  const { t } = useLang();

  return (
    <div>
      {/* ── HERO ── */}
      <section className="relative overflow-hidden pb-20 pt-28">
        <div className="gold-line absolute inset-x-0 top-0" />
        <div className="pointer-events-none absolute left-1/2 top-1/3 h-[500px] w-[500px] -translate-x-1/2 rounded-full bg-gold/5 blur-3xl" />

        <div className="relative mx-auto max-w-4xl px-6 text-center">
          <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-gold/30 bg-gold/10 px-4 py-1.5 text-sm text-gold">
            {t("✦ أكاديمية القرآن الكريم عبر الإنترنت", "✦ Online Quran Learning Academy")}
          </div>

          <h1 className="font-display text-5xl font-bold leading-[1.2] md:text-7xl">
            {t("تعلّم", "Learn")}{" "}
            <span className="text-gold">{t("القرآن", "Quran")}</span>
            <br />
            {t("مع أمهر المعلمين", "With Expert Teachers")}
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted">
            {t(
              "معلمون حاصلون على الإجازة · جلسات فيديو مباشرة · جدول يناسبك · من أي مكان في العالم",
              "Certified teachers with Ijazah · Live video sessions · Flexible schedule · From anywhere in the world",
            )}
          </p>

          <div className="mt-10 flex flex-wrap justify-center gap-4">
            <Link href="/contact" className="rounded border border-gold bg-gold px-8 py-3.5 font-semibold text-background transition-colors hover:bg-gold-hover">
              {t("احجز جلسة تجريبية مجانية", "Book a Free Trial Session")}
            </Link>
            <Link href="/services" className="rounded border border-card-border px-8 py-3.5 text-muted transition-colors hover:border-gold/40 hover:text-gold">
              {t("تعرف على خدماتنا", "Explore Our Services")}
            </Link>
          </div>

          <p className="mt-6 text-sm text-muted">
            {t("✓ مجاني للبدء · ✓ بدون بطاقة ائتمان · ✓ إلغاء في أي وقت", "✓ Free to start · ✓ No credit card · ✓ Cancel anytime")}
          </p>

          <div className="mx-auto mt-14 grid max-w-lg grid-cols-3 gap-4">
            {[
              { num: t("١٥K+", "15K+"), label: t("طالب مسجل", "Students") },
              { num: t("٩٨٪", "98%"), label: t("رضا الطلاب", "Satisfaction") },
              { num: t("٥٠+", "50+"), label: t("معلم معتمد", "Certified Teachers") },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border border-card-border bg-card p-4">
                <p className="font-display text-2xl font-bold text-gold">{s.num}</p>
                <p className="text-xs text-muted">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 3 STEPS ── */}
      <section className="border-t border-card-border py-24">
        <div className="mx-auto max-w-7xl px-6">
          <p className="text-sm font-medium tracking-widest text-gold">❖ {t("كيف يعمل", "How It Works")}</p>
          <h2 className="font-display mt-3 text-4xl font-bold">{t("ابدأ في ٣ خطوات بسيطة", "Start in 3 Simple Steps")}</h2>

          <div className="mt-16 grid gap-px overflow-hidden rounded-xl border border-card-border md:grid-cols-3">
            {[
              { icon: Users, title: t("سجّل حسابك", "Create Account"), desc: t("أنشئ حسابك المجاني واحجز جلسة تجريبية بدون بطاقة ائتمان.", "Create your free account and book a trial session — no credit card needed.") },
              { icon: Calendar, title: t("اختر معلمك", "Choose Teacher"), desc: t("تصفح المعلمين المعتمدين واختر الأنسب لمستواك وأهدافك.", "Browse certified teachers and pick the best match for your level and goals.") },
              { icon: Video, title: t("ابدأ التعلم", "Start Learning"), desc: t("انضم لجلستك عبر الفيديو المدمج وتابع تقدمك في الحفظ.", "Join your session via built-in video and track your memorization progress.") },
            ].map((s, i) => (
              <div key={i} className="bg-card p-8 md:border-l md:border-card-border md:first:border-l-0">
                <s.icon size={28} className="mb-4 text-gold" />
                <h3 className="text-lg font-bold">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── WHY FURQAN ── */}
      <section className="border-t border-card-border bg-card/30 py-24">
        <div className="mx-auto max-w-7xl px-6">
          <p className="text-sm font-medium tracking-widest text-gold">❖ {t("لماذا فرقان", "Why FURQAN")}</p>
          <h2 className="font-display mt-3 text-4xl font-bold">{t("لماذا تختار فرقان؟", "Why Choose FURQAN?")}</h2>

          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { icon: Shield, ar: "معلمون معتمدون بالإجازة", en: "Certified Teachers with Ijazah", dAr: "جميع معلمينا حاصلون على إجازة من كبار العلماء", dEn: "All our teachers hold Ijazah from senior scholars" },
              { icon: Video, ar: "جلسات فيديو مدمجة", en: "Built-in Video Sessions", dAr: "لا حاجة لزوم أو سكايب — الفيديو مدمج في المنصة", dEn: "No Zoom or Skype needed — video is built into the platform" },
              { icon: Calendar, ar: "جدول مرن يناسبك", en: "Flexible Schedule", dAr: "احجز في أي وقت — صباحاً أو مساءً، ٧ أيام", dEn: "Book any time — morning or evening, 7 days a week" },
              { icon: Users, ar: "جلسات فردية ١:١", en: "1-on-1 Sessions", dAr: "كل طالب يحصل على اهتمام كامل من معلمه", dEn: "Every student gets full attention from their teacher" },
              { icon: Star, ar: "معلمات للأخوات والأطفال", en: "Female Teachers Available", dAr: "متاح معلمات متخصصات في بيئة آمنة", dEn: "Female teachers available for sisters and children" },
              { icon: TrendingUp, ar: "تتبع تقدمك", en: "Track Your Progress", dAr: "لوحة تحكم تعرض تقدمك في الحفظ والجلسات", dEn: "Dashboard showing your memorization and session progress" },
              { icon: Globe, ar: "يخدم ٥٠+ دولة", en: "Serving 50+ Countries", dAr: "طلابنا في أمريكا وأوروبا والخليج وأستراليا", dEn: "Students in USA, Europe, Gulf, Australia and more" },
              { icon: Award, ar: "جلسة تجريبية مجانية", en: "Free Trial Session", dAr: "ابدأ بجلسة مجانية بدون أي التزام", dEn: "Start with a free session — no commitment required" },
            ].map((f) => (
              <div key={f.en} className="rounded-xl border border-card-border bg-surface p-5 transition-colors hover:border-gold/30">
                <f.icon size={22} className="mb-3 text-gold" />
                <h3 className="text-sm font-bold">{t(f.ar, f.en)}</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted">{t(f.dAr, f.dEn)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── COURSES ── */}
      <section className="border-t border-card-border py-24">
        <div className="mx-auto max-w-7xl px-6">
          <p className="text-sm font-medium tracking-widest text-gold">❖ {t("التخصصات", "Courses")}</p>
          <h2 className="font-display mt-3 text-4xl font-bold">{t("ما نُعلّمه في فرقان", "What We Teach at FURQAN")}</h2>

          <div className="mt-12 grid grid-cols-2 gap-4 md:grid-cols-3">
            {[
              { ar: "حفظ القرآن", en: "Quran Memorization", dAr: "احفظ كتاب الله مع معلم متخصص بمنهج تدريجي", dEn: "Memorize the Quran with a specialist teacher using a gradual method" },
              { ar: "التجويد", en: "Tajweed", dAr: "أتقن أحكام التلاوة بأسلوب علمي ممنهج", dEn: "Master the rules of recitation with a structured scientific approach" },
              { ar: "المراجعة", en: "Revision", dAr: "راجع محفوظاتك مع معلم يتابع تقدمك", dEn: "Review your memorization with a teacher who tracks your progress" },
              { ar: "التلاوة", en: "Recitation", dAr: "حسّن أداءك مع شيخ متخصص في المقامات", dEn: "Improve your recitation with a specialized sheikh" },
              { ar: "القراءات", en: "Qira'at", dAr: "تعلّم روايات حفص وورش وقالون والدوري", dEn: "Learn the readings of Hafs, Warsh, Qalun and Al-Duri" },
              { ar: "التفسير", en: "Tafsir", dAr: "افهم معاني القرآن وتدبّر آياته", dEn: "Understand the meanings of the Quran and reflect on its verses" },
            ].map((c) => (
              <Link key={c.en} href="/services" className="rounded-xl border border-card-border bg-card p-5 transition-colors hover:border-gold/30">
                <h3 className="font-bold text-gold">{t(c.ar, c.en)}</h3>
                <p className="mt-2 text-xs text-muted">{t(c.dAr, c.dEn)}</p>
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

      {/* ── TESTIMONIALS ── */}
      <div className="border-t border-card-border">
        <Testimonials />
      </div>

      {/* ── PACKAGES PREVIEW ── */}
      <section className="border-t border-card-border py-24">
        <div className="mx-auto max-w-5xl px-6">
          <p className="text-sm font-medium tracking-widest text-gold">❖ {t("الباقات", "Packages")}</p>
          <h2 className="font-display mt-3 text-4xl font-bold">{t("باقاتنا", "Our Packages")}</h2>

          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {[
              { ar: "الباقة الأساسية", en: "Starter", price: "$40", freq: t("٢ أيام/أسبوع", "2 days/week") },
              { ar: "الباقة المتقدمة", en: "Premium", price: "$65", freq: t("٥ أيام/أسبوع", "5 days/week"), featured: true },
              { ar: "باقة نهاية الأسبوع", en: "Weekend", price: "$60", freq: t("السبت والأحد", "Sat & Sun") },
            ].map((p) => (
              <div key={p.en} className={`rounded-2xl p-6 ${p.featured ? "border-2 border-gold bg-card" : "border border-card-border bg-card"}`}>
                {p.featured && <span className="mb-3 inline-block rounded-full bg-gold px-3 py-1 text-xs font-bold text-background">{t("الأكثر طلباً", "Most Popular")}</span>}
                <h3 className="text-lg font-bold">{t(p.ar, p.en)}</h3>
                <p className="font-display mt-2 text-3xl font-bold text-gold">{p.price}<span className="text-sm font-normal text-muted">{t("/شهر", "/mo")}</span></p>
                <p className="mt-1 text-xs text-muted">{p.freq}</p>
                <Link href="/packages" className="mt-4 block rounded border border-gold bg-gold/10 py-2 text-center text-sm font-medium text-gold transition-colors hover:bg-gold hover:text-background">
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

      <FreeTrialBanner />
    </div>
  );
}
