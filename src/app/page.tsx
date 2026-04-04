import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowLeft,
  BookMarked,
  BookOpen,
  CalendarCheck,
  CheckCircle,
  Layers,
  Mic,
  RefreshCw,
  Search,
  Star,
  Video,
  Volume2,
} from "lucide-react";

export const metadata: Metadata = {
  title: "فرقان — أكاديمية القرآن الكريم",
};

const SUBJECTS = [
  { icon: BookOpen, title: "حفظ القرآن", desc: "احفظ كتاب الله مع معلم متخصص بمنهج تدريجي ومدروس" },
  { icon: Mic, title: "التجويد", desc: "أتقن أحكام التلاوة وتجويد القرآن بأسلوب علمي ممنهج" },
  { icon: RefreshCw, title: "المراجعة", desc: "راجع محفوظاتك مع معلم يتابع تقدمك ويعزز ما حفظته" },
  { icon: Volume2, title: "التلاوة", desc: "حسّن تلاوتك وأداءك مع شيخ متخصص في مقامات التلاوة" },
  { icon: Layers, title: "القراءات", desc: "تعلّم روايات حفص وورش وقالون مع معلمين حاصلين على الإجازة" },
  { icon: BookMarked, title: "التفسير", desc: "افهم معاني القرآن وتدبّر آياته مع شيخ متخصص في التفسير" },
];

export default function LandingPage() {
  return (
    <div dir="rtl">
      {/* ── NAV ── */}
      <nav className="fixed inset-x-0 top-0 z-50 border-b border-card-border/50 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div>
            <span className="text-2xl font-bold text-gold">فُرقان</span>
            <p className="hidden text-xs text-muted sm:block">FURQAN Academy</p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="rounded-lg border border-card-border px-4 py-2 text-sm text-muted transition-colors hover:border-foreground/30 hover:text-foreground focus-ring"
            >
              تسجيل الدخول
            </Link>
            <Link
              href="/register"
              className="rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-gold-hover focus-ring"
            >
              ابدأ مجاناً
            </Link>
          </div>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section className="relative flex min-h-screen items-center justify-center overflow-hidden pt-16">
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gold/5 blur-3xl" />

        <div className="relative mx-auto max-w-3xl px-4 text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-gold/30 bg-gold/10 px-4 py-1.5 text-sm text-gold">
            أكاديمية القرآن الكريم عبر الإنترنت
          </div>

          <h1 className="mb-6 text-5xl font-bold leading-tight md:text-6xl">
            تعلّم القرآن
            <br />
            مع <span className="text-gold">أمهر</span> المعلمين
          </h1>
          <p className="text-xl text-muted">
            Learn Quran with certified expert teachers — online, one-on-one
          </p>

          <p className="mx-auto mb-8 mt-6 max-w-xl text-lg leading-relaxed text-muted">
            احجز جلساتك بسهولة واحترافية. تعلّم التجويد والحفظ والتلاوة مع معلمين حاصلين على الإجازة، من أي مكان في العالم.
          </p>

          <div className="flex flex-wrap justify-center gap-4">
            <Link
              href="/register"
              className="rounded-lg bg-gold px-8 py-3 text-lg font-semibold text-black transition-colors hover:bg-gold-hover focus-ring"
            >
              ابدأ رحلتك الآن
            </Link>
            <a
              href="#how-it-works"
              className="rounded-lg border border-card-border px-8 py-3 text-lg text-muted transition-colors hover:border-foreground/30 hover:text-foreground focus-ring"
            >
              كيف يعمل فرقان؟
            </a>
          </div>

          <p className="mt-4 text-sm text-muted">
            ✓ مجاني للبدء · ✓ بدون بطاقة ائتمان · ✓ جلسة تجريبية مجانية
          </p>

          {/* Stats strip */}
          <div className="mt-12 grid grid-cols-3 border-y border-card-border py-6">
            {[
              { num: "١٥٠٠٠+", ar: "طالب مسجل" },
              { num: "٩٨٪", ar: "رضا الطلاب" },
              { num: "٥٠+", ar: "معلم معتمد" },
            ].map((s) => (
              <div key={s.ar}>
                <p className="text-3xl font-bold text-gold">{s.num}</p>
                <p className="text-sm text-muted">{s.ar}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS — horizontal flow, not card grid ── */}
      <section id="how-it-works" className="border-t border-card-border py-24">
        <div className="mx-auto max-w-5xl px-4">
          <h2 className="mb-4 text-center text-3xl font-bold">كيف يعمل فرقان؟</h2>
          <p className="mb-16 text-center text-muted">ثلاث خطوات بسيطة لبدء رحلتك</p>

          {/* Horizontal stepped flow */}
          <div className="relative">
            {/* Connecting line (desktop only) */}
            <div className="absolute top-8 right-[16%] left-[16%] hidden h-px bg-card-border md:block" />

            <div className="grid gap-12 md:grid-cols-3 md:gap-0">
              {[
                { num: "١", icon: Search, title: "اختر معلمك", desc: "تصفح معلمين حاصلين على الإجازة بحسب التخصص واللغة والسعر" },
                { num: "٢", icon: CalendarCheck, title: "احجز جلستك", desc: "اختر الوقت المناسب من جدول المعلم وأكد حجزك في دقائق" },
                { num: "٣", icon: Video, title: "تعلّم وتقدّم", desc: "التحق بجلستك عبر الفيديو وتابع تقدمك في الحفظ والتجويد" },
              ].map((step) => (
                <div key={step.num} className="text-center">
                  <div className="relative mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border-2 border-gold/30 bg-card">
                    <step.icon size={24} className="text-gold" />
                    <span className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full bg-gold text-xs font-bold text-black">
                      {step.num}
                    </span>
                  </div>
                  <h3 className="mb-2 text-lg font-semibold">{step.title}</h3>
                  <p className="mx-auto max-w-xs text-sm leading-relaxed text-muted">{step.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── SPECIALIZATIONS — compact, no individual cards ── */}
      <section className="bg-card/30 py-20">
        <div className="mx-auto max-w-5xl px-4">
          <div className="mb-12 md:flex md:items-end md:justify-between">
            <div>
              <h2 className="text-3xl font-bold">تخصصاتنا</h2>
              <p className="mt-2 text-muted">ستة مسارات تعليمية متكاملة</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {SUBJECTS.map((s) => (
              <div key={s.title} className="rounded-xl border border-card-border bg-card p-5 transition-colors hover:border-gold/30">
                <s.icon size={22} className="mb-2 text-gold" />
                <h3 className="mb-1 text-sm font-semibold">{s.title}</h3>
                <p className="text-xs leading-relaxed text-muted">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── TEACHERS — asymmetric: featured + side list ── */}
      <section className="py-24">
        <div className="mx-auto max-w-5xl px-4">
          <h2 className="mb-2 text-3xl font-bold">معلمونا</h2>
          <p className="mb-12 text-muted">جميع معلمينا حاصلون على إجازة في القرآن الكريم</p>

          <div className="gap-6 md:flex">
            {/* Featured teacher — large */}
            <div className="mb-6 flex-1 rounded-2xl border border-card-border bg-card p-8 md:mb-0">
              <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full border-2 border-gold/30 bg-background text-2xl font-bold">
                م
              </div>
              <h3 className="text-xl font-bold">الشيخ محمد العمري</h3>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className="rounded-full border border-gold/30 bg-gold/10 px-2.5 py-0.5 text-xs text-gold">تجويد وحفظ</span>
                <span className="rounded-full border border-card-border px-2 py-0.5 text-xs text-muted">حفص عن عاصم</span>
              </div>
              <div className="mt-3 flex items-center gap-0.5">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Star key={i} size={14} className="fill-gold text-gold" />
                ))}
                <span className="mr-2 text-sm text-muted">٢٤٠ جلسة</span>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                معلم متخصص في الحفظ والتجويد مع أكثر من ١٠ سنوات خبرة في تعليم القرآن الكريم عبر الإنترنت.
              </p>
              <p className="mt-4 text-2xl font-bold text-gold">$25 <span className="text-sm font-normal text-muted">/ ساعة</span></p>
            </div>

            {/* Side list — compact */}
            <div className="flex flex-col gap-3 md:w-80">
              {[
                { initial: "أ", name: "الشيخة أمينة الشريف", spec: "تجويد وتلاوة", note: "للأخوات فقط", sessions: "١٨٠", rate: 20 },
                { initial: "ع", name: "الشيخ عبدالرحمن فارس", spec: "حفظ ومراجعة", sessions: "٣١٠", rate: 30 },
              ].map((t) => (
                <div key={t.name} className="rounded-xl border border-card-border bg-card p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-card-border bg-background font-bold">
                      {t.initial}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{t.name}</p>
                      <p className="text-xs text-muted">
                        {t.spec} · {t.sessions} جلسة
                        {t.note && <span className="mr-1">· {t.note}</span>}
                      </p>
                    </div>
                    <p className="text-lg font-bold text-gold">${t.rate}</p>
                  </div>
                </div>
              ))}

              <Link
                href="/register"
                className="mt-2 flex items-center justify-center gap-2 rounded-xl border border-card-border py-3 text-sm text-muted transition-colors hover:border-gold/30 hover:text-gold focus-ring"
              >
                تصفح جميع المعلمين
                <ArrowLeft size={14} />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── TESTIMONIAL — single featured quote ── */}
      <section className="border-y border-card-border bg-card/20 py-20">
        <div className="mx-auto max-w-3xl px-4 text-center">
          <span className="text-5xl leading-none text-gold/20">❝</span>
          <blockquote className="mt-4 text-xl leading-relaxed">
            بعد سنوات من المحاولة، وجدت أخيراً معلماً يفهم احتياجاتي. أتممت حفظ جزء عمّ في ثلاثة أشهر فقط بفضل الله ثم بفضل معلمي في فرقان.
          </blockquote>
          <div className="mt-6">
            <p className="font-semibold">أحمد السيد</p>
            <p className="text-sm text-muted">لندن 🇬🇧</p>
          </div>

          {/* Secondary quotes — compact */}
          <div className="mt-10 grid gap-4 border-t border-card-border pt-8 md:grid-cols-2">
            <div className="text-right">
              <p className="text-sm leading-relaxed text-muted">
                &ldquo;الجدول المرن أتاح لي التعلم رغم انشغالي بعملي وأطفالي. معلمتي صبورة جداً وأسلوبها رائع.&rdquo;
              </p>
              <p className="mt-2 text-xs font-medium">فاطمة علي · تورنتو 🇨🇦</p>
            </div>
            <div className="text-right">
              <p className="text-sm leading-relaxed text-muted">
                &ldquo;كنت أخجل من مستواي في التلاوة، لكن المعلم أعطاني الثقة وطوّر تلاوتي بشكل ملحوظ خلال شهرين.&rdquo;
              </p>
              <p className="mt-2 text-xs font-medium">عمر حسين · دبي 🇦🇪</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── PRICING — reframed as price guide, not SaaS tiers ── */}
      <section className="py-24">
        <div className="mx-auto max-w-4xl px-4">
          <h2 className="mb-2 text-center text-3xl font-bold">أسعار مرنة تناسبك</h2>
          <p className="mb-4 text-center text-muted">الأسعار تحدد مع المعلم مباشرة — هذه نطاقات أسعار شائعة</p>
          <p className="mb-12 text-center text-xs text-muted">Prices agreed directly with teachers — these are typical ranges</p>

          {/* Price guide — horizontal on desktop */}
          <div className="grid gap-4 md:grid-cols-3">
            {[
              { level: "مبتدئ", en: "Beginner", range: "$15–20", freq: "جلسة أسبوعياً", dur: "30–45 دقيقة", features: ["تعلّم القراءة والتجويد الأساسي", "تقرير تقدم شهري"] },
              { level: "متوسط", en: "Intermediate", range: "$20–30", freq: "جلستان أسبوعياً", dur: "45–60 دقيقة", features: ["حفظ ومراجعة مع تجويد", "تقرير أسبوعي", "اختيار المعلم المفضل"], featured: true },
              { level: "متقدم", en: "Advanced", range: "$25–40", freq: "3+ جلسات أسبوعياً", dur: "60 دقيقة", features: ["إجازة وقراءات متعددة", "منهج مخصص لأهدافك"] },
            ].map((plan) => (
              <div
                key={plan.level}
                className={`rounded-2xl p-6 ${
                  plan.featured
                    ? "border-2 border-gold bg-card"
                    : "border border-card-border bg-card"
                }`}
              >
                <p className="text-sm text-muted">{plan.level} <span className="text-xs">({plan.en})</span></p>
                <p className="mt-1 text-2xl font-bold text-gold">{plan.range}</p>
                <p className="text-xs text-muted">/ ساعة · {plan.freq} · {plan.dur}</p>
                <ul className="mt-4 space-y-2">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-muted">
                      <CheckCircle size={14} className="mt-0.5 shrink-0 text-gold" />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <p className="mt-6 text-center text-xs text-muted">
            جلسة تجريبية مجانية متاحة مع كل معلم
          </p>

          {/* Mid-page CTA repeat for mobile scrollers */}
          <div className="mt-8 text-center">
            <Link
              href="/register"
              className="inline-block rounded-lg bg-gold px-8 py-3 font-semibold text-black transition-colors hover:bg-gold-hover focus-ring"
            >
              سجّل مجاناً وابدأ الآن
            </Link>
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ── */}
      <section className="py-16">
        <div className="mx-4">
          <div className="mx-auto max-w-4xl rounded-3xl border border-gold/20 bg-gradient-to-l from-gold/5 via-gold/10 to-gold/5 px-8 py-16 text-center md:px-16">
            <BookOpen size={40} className="mx-auto mb-6 text-gold" />
            <h2 className="text-3xl font-bold md:text-4xl">ابدأ رحلتك مع القرآن اليوم</h2>
            <p className="mt-4 text-lg text-gold/50">
              ﴿ وَرَتِّلِ الْقُرْآنَ تَرْتِيلًا ﴾
            </p>
            <p className="text-sm text-muted">سورة المزمل</p>
            <Link
              href="/register"
              className="mt-8 inline-block rounded-lg bg-gold px-10 py-4 text-lg font-semibold text-black transition-colors hover:bg-gold-hover focus-ring"
            >
              سجّل مجاناً وابدأ الآن
            </Link>
            <p className="mt-3 text-sm text-muted">
              ✓ لا يلزم بطاقة ائتمان · ✓ جلسة تجريبية مجانية
            </p>
          </div>
        </div>
      </section>

      {/* ── FOOTER — cleaned up ── */}
      <footer className="border-t border-card-border py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-4 text-center md:flex-row md:justify-between md:text-right">
          <div>
            <span className="text-xl font-bold text-gold">فُرقان</span>
            <p className="mt-1 text-xs text-muted">أكاديمية القرآن الكريم عبر الإنترنت</p>
          </div>
          <div className="flex gap-6 text-sm text-muted">
            <Link href="/" className="transition-colors hover:text-foreground">الرئيسية</Link>
            <Link href="/login" className="transition-colors hover:text-foreground">تسجيل الدخول</Link>
            <Link href="/register" className="transition-colors hover:text-foreground">إنشاء حساب</Link>
            <a href="#how-it-works" className="transition-colors hover:text-foreground">كيف يعمل</a>
          </div>
          <p className="text-xs text-muted">© 2025 فرقان</p>
        </div>
      </footer>
    </div>
  );
}
