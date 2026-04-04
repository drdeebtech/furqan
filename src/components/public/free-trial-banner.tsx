import Link from "next/link";
import { BookOpen } from "lucide-react";

/**
 * Renders a centered call-to-action banner promoting a free Quran trial.
 *
 * The banner includes an icon, Arabic and English headings, a Quran verse line,
 * two CTA links (contact and packages), and a short free-trial disclaimer.
 *
 * @returns A JSX element containing the styled free trial banner.
 */
export function FreeTrialBanner() {
  return (
    <section className="px-4 py-16">
      <div className="mx-auto max-w-4xl rounded-3xl border border-gold/20 bg-gradient-to-l from-gold/5 via-gold/10 to-gold/5 p-12 text-center md:p-16">
        <BookOpen size={40} className="mx-auto mb-4 text-gold" />
        <h2 className="font-display text-3xl font-bold">ابدأ رحلتك مع القرآن اليوم</h2>
        <p className="mt-2 text-sm text-muted">Start your Quran journey today</p>
        <p className="font-display mt-4 text-lg text-gold/50">
          ﴿ وَرَتِّلِ الْقُرْآنَ تَرْتِيلًا ﴾
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-4">
          <Link
            href="/contact"
            className="rounded border border-gold bg-gold px-8 py-3 font-semibold text-background transition-colors hover:bg-gold-hover"
          >
            احجز جلسة تجريبية مجانية
          </Link>
          <Link
            href="/packages"
            className="rounded border border-card-border px-8 py-3 text-muted transition-colors hover:border-gold/40 hover:text-gold"
          >
            تعرف على باقاتنا
          </Link>
        </div>
        <p className="mt-4 text-xs text-muted">✓ مجاني · ✓ بدون بطاقة ائتمان · ✓ خلال ٢٤ ساعة</p>
      </div>
    </section>
  );
}
