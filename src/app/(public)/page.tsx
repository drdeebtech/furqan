import type { Metadata } from "next";
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
import { Testimonials } from "@/components/public/testimonials";
import { FreeTrialBanner } from "@/components/public/free-trial-banner";

export const metadata: Metadata = { title: "فرقان — أكاديمية القرآن الكريم" };

export default function HomePage() {
  return (
    <div dir="rtl">
      {/* ── HERO ── */}
      <section className="relative overflow-hidden pb-20 pt-28">
        <div className="gold-line absolute inset-x-0 top-0" />
        <div className="pointer-events-none absolute left-1/2 top-1/3 h-[500px] w-[500px] -translate-x-1/2 rounded-full bg-gold/5 blur-3xl" />

        <div className="relative mx-auto max-w-4xl px-6 text-center">
          <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-gold/30 bg-gold/10 px-4 py-1.5 text-sm text-gold">
            ✦ أكاديمية القرآن الكريم عبر الإنترنت · Online Quran Academy
          </div>

          <h1 className="font-display text-5xl font-bold leading-[1.2] md:text-7xl">
            تعلّم <span className="text-gold">القرآن</span>
            <br />
            مع أمهر المعلمين
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted">
            معلمون حاصلون على الإجازة · جلسات فيديو مباشرة · جدول يناسبك · من أي مكان في العالم
          </p>

          <div className="mt-10 flex flex-wrap justify-center gap-4">
            <Link href="/contact" className="rounded border border-gold bg-gold px-8 py-3.5 font-semibold text-background transition-colors hover:bg-gold-hover">
              احجز جلسة تجريبية مجانية
            </Link>
            <Link href="/services" className="rounded border border-card-border px-8 py-3.5 text-muted transition-colors hover:border-gold/40 hover:text-gold">
              تعرف على خدماتنا
            </Link>
          </div>

          <p className="mt-6 text-sm text-muted">✓ مجاني للبدء · ✓ بدون بطاقة ائتمان · ✓ إلغاء في أي وقت</p>

          {/* Stats */}
          <div className="mx-auto mt-14 grid max-w-lg grid-cols-3 gap-4">
            {[
              { num: "١٥K+", label: "طالب مسجل" },
              { num: "٩٨٪", label: "رضا الطلاب" },
              { num: "٥٠+", label: "معلم معتمد" },
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
          <p className="text-sm font-medium tracking-widest text-gold">❖ كيف يعمل</p>
          <h2 className="font-display mt-3 text-4xl font-bold">ابدأ في ٣ خطوات بسيطة</h2>
          <p className="mt-2 text-sm text-muted">Begin Learning in 3 Easy Steps</p>

          <div className="mt-16 grid gap-px overflow-hidden rounded-xl border border-card-border md:grid-cols-3">
            {[
              { num: "١", icon: Users, title: "سجّل حسابك", desc: "أنشئ حسابك المجاني واحجز جلسة تجريبية بدون بطاقة ائتمان." },
              { num: "٢", icon: Calendar, title: "اختر معلمك", desc: "تصفح المعلمين المعتمدين واختر الأنسب لمستواك وأهدافك." },
              { num: "٣", icon: Video, title: "ابدأ التعلم", desc: "انضم لجلستك عبر الفيديو المدمج وتابع تقدمك في الحفظ." },
            ].map((s) => (
              <div key={s.num} className="bg-card p-8 md:border-l md:border-card-border md:first:border-l-0">
                <s.icon size={28} className="mb-4 text-gold" />
                <span className="font-display text-4xl text-gold/15">{s.num}</span>
                <h3 className="mt-2 text-lg font-bold">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── WHY FURQAN ── */}
      <section className="border-t border-card-border bg-card/30 py-24">
        <div className="mx-auto max-w-7xl px-6">
          <p className="text-sm font-medium tracking-widest text-gold">❖ لماذا فرقان</p>
          <h2 className="font-display mt-3 text-4xl font-bold">لماذا تختار فرقان؟</h2>
          <p className="mt-2 text-sm text-muted">Why Choose FURQAN?</p>

          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { icon: Shield, title: "معلمون معتمدون بالإجازة", desc: "جميع معلمينا حاصلون على إجازة من كبار العلماء" },
              { icon: Video, title: "جلسات فيديو مدمجة", desc: "لا حاجة لزوم أو سكايب — الفيديو مدمج في المنصة" },
              { icon: Calendar, title: "جدول مرن يناسبك", desc: "احجز في أي وقت — صباحاً أو مساءً، ٧ أيام" },
              { icon: Users, title: "جلسات فردية ١:١", desc: "كل طالب يحصل على اهتمام كامل من معلمه" },
              { icon: Star, title: "معلمات للأخوات والأطفال", desc: "متاح معلمات متخصصات في بيئة آمنة" },
              { icon: TrendingUp, title: "تتبع تقدمك", desc: "لوحة تحكم تعرض تقدمك في الحفظ والجلسات" },
              { icon: Globe, title: "يخدم ٥٠+ دولة", desc: "طلابنا في أمريكا وأوروبا والخليج وأستراليا" },
              { icon: Award, title: "جلسة تجريبية مجانية", desc: "ابدأ بجلسة مجانية بدون أي التزام" },
            ].map((f) => (
              <div key={f.title} className="rounded-xl border border-card-border bg-surface p-5 transition-colors hover:border-gold/30">
                <f.icon size={22} className="mb-3 text-gold" />
                <h3 className="text-sm font-bold">{f.title}</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── COURSES PREVIEW ── */}
      <section className="border-t border-card-border py-24">
        <div className="mx-auto max-w-7xl px-6">
          <p className="text-sm font-medium tracking-widest text-gold">❖ التخصصات</p>
          <h2 className="font-display mt-3 text-4xl font-bold">ما نُعلّمه في فرقان</h2>

          <div className="mt-12 grid grid-cols-2 gap-4 md:grid-cols-3">
            {[
              { title: "حفظ القرآن", desc: "احفظ كتاب الله مع معلم متخصص بمنهج تدريجي" },
              { title: "التجويد", desc: "أتقن أحكام التلاوة بأسلوب علمي ممنهج" },
              { title: "المراجعة", desc: "راجع محفوظاتك مع معلم يتابع تقدمك" },
              { title: "التلاوة", desc: "حسّن أداءك مع شيخ متخصص في المقامات" },
              { title: "القراءات", desc: "تعلّم روايات حفص وورش وقالون والدوري" },
              { title: "التفسير", desc: "افهم معاني القرآن وتدبّر آياته" },
            ].map((c) => (
              <Link key={c.title} href="/services" className="rounded-xl border border-card-border bg-card p-5 transition-colors hover:border-gold/30">
                <h3 className="font-bold text-gold">{c.title}</h3>
                <p className="mt-2 text-xs text-muted">{c.desc}</p>
              </Link>
            ))}
          </div>

          <div className="mt-8 text-center">
            <Link href="/services" className="text-sm font-medium text-gold transition-colors hover:text-gold-light">عرض جميع الخدمات ←</Link>
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
          <p className="text-sm font-medium tracking-widest text-gold">❖ الباقات</p>
          <h2 className="font-display mt-3 text-4xl font-bold">باقاتنا</h2>

          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {[
              { name: "الباقة الأساسية", price: "$40", freq: "٢ أيام/أسبوع · ٨ جلسات/شهر" },
              { name: "الباقة المتقدمة", price: "$65", freq: "٥ أيام/أسبوع · ٢٠ جلسة/شهر", featured: true },
              { name: "باقة نهاية الأسبوع", price: "$60", freq: "السبت والأحد · ٨ جلسات/شهر" },
            ].map((p) => (
              <div key={p.name} className={`rounded-2xl p-6 ${p.featured ? "border-2 border-gold bg-card" : "border border-card-border bg-card"}`}>
                {p.featured && <span className="mb-3 inline-block rounded-full bg-gold px-3 py-1 text-xs font-bold text-background">الأكثر طلباً</span>}
                <h3 className="text-lg font-bold">{p.name}</h3>
                <p className="font-display mt-2 text-3xl font-bold text-gold">{p.price}<span className="text-sm font-normal text-muted">/شهر</span></p>
                <p className="mt-1 text-xs text-muted">{p.freq}</p>
                <Link href="/packages" className="mt-4 block rounded border border-gold bg-gold/10 py-2 text-center text-sm font-medium text-gold transition-colors hover:bg-gold hover:text-background">
                  التفاصيل
                </Link>
              </div>
            ))}
          </div>

          <div className="mt-8 text-center">
            <Link href="/packages" className="text-sm font-medium text-gold transition-colors hover:text-gold-light">عرض جميع الباقات ←</Link>
          </div>
        </div>
      </section>

      {/* ── FREE TRIAL CTA ── */}
      <FreeTrialBanner />
    </div>
  );
}
