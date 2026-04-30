import Link from "next/link";
import { ArrowLeft, Home, Search } from "lucide-react";

export default function NotFound() {
  return (
    <div
      dir="rtl"
      className="islamic-pattern relative flex min-h-[80vh] flex-col items-center justify-center overflow-hidden px-4 py-16"
    >
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-background/40 via-transparent to-background" aria-hidden="true" />

      <div className="relative z-10 flex flex-col items-center text-center">
        <p className="font-display text-7xl font-bold text-gold sm:text-8xl" aria-hidden="true">
          ٤٠٤
        </p>

        <h1 className="mt-4 font-display text-2xl font-bold text-foreground sm:text-3xl">
          الصفحة غير موجودة
        </h1>
        <p className="mt-1 text-sm text-muted">
          The page you’re looking for can’t be found
        </p>

        <p className="mt-6 max-w-md text-sm leading-relaxed text-muted">
          ربما تم نقلها أو لم تعد متاحة. تحقّق من الرابط أو ارجع إلى الصفحة الرئيسية.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/"
            className="glass-gold glass-pill inline-flex items-center gap-2 px-6 py-2.5 text-sm font-semibold text-background transition-colors hover:bg-gold-hover focus-ring"
          >
            <Home size={14} aria-hidden="true" />
            العودة للرئيسية
            <span dir="ltr" className="text-xs opacity-70">· Back home</span>
          </Link>
          <Link
            href="/contact"
            className="glass glass-pill inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-gold transition-colors hover:bg-gold/10 focus-ring"
          >
            <Search size={14} aria-hidden="true" />
            تواصل معنا
            <ArrowLeft size={12} aria-hidden="true" />
          </Link>
        </div>

        <p className="mt-12 max-w-sm font-display text-sm leading-relaxed text-gold/60">
          ﴿ وَمَن يَتَوَكَّلْ عَلَى اللَّهِ فَهُوَ حَسْبُهُ ﴾
        </p>
      </div>
    </div>
  );
}
