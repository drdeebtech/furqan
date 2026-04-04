import Link from "next/link";
import { CheckCircle } from "lucide-react";

/**
 * Renders a two-panel, right-to-left authentication page layout with a desktop-only branding panel and a form/content panel that displays the provided children.
 *
 * @param children - Content to render inside the form panel's card (e.g., sign-in or sign-up form).
 * @returns The authentication layout JSX element wrapping `children`.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div dir="rtl" className="flex min-h-screen">
      {/* Branding panel */}
      <div className="hidden flex-col justify-center border-l border-surface-border bg-surface p-12 md:flex md:w-1/2">
        <div className="mx-auto max-w-sm">
          <Link href="/" className="font-display text-4xl font-bold text-gold">
            فُرقان
          </Link>
          <p className="mt-3 text-lg">أكاديمية القرآن الكريم</p>
          <p className="mt-1 text-sm text-muted">FURQAN Online Quran Academy</p>

          <div className="my-8 h-px bg-surface-border" />

          {[
            { ar: "معلمون حاصلون على الإجازة", en: "Certified teachers" },
            { ar: "جلسات مرنة عبر الفيديو", en: "Flexible video sessions" },
            { ar: "تتبع تقدمك في الحفظ", en: "Track your memorization progress" },
          ].map((f) => (
            <div key={f.en} className="mb-4 flex items-start gap-3">
              <CheckCircle size={18} className="mt-0.5 shrink-0 text-gold" />
              <div>
                <p className="text-sm font-medium">{f.ar}</p>
                <p className="text-xs text-muted">{f.en}</p>
              </div>
            </div>
          ))}

          <p className="mt-12 font-display text-sm text-gold/40">
            ﴿ وَمَن يَتَّقِ اللَّهَ يَجْعَل لَّهُ مَخْرَجًا ﴾
          </p>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex w-full flex-col justify-center px-4 py-12 md:w-1/2 md:px-12">
        <div className="mx-auto w-full max-w-md">
          <Link href="/" className="mb-6 inline-block text-sm text-gold transition-colors hover:text-gold-light">
            ← العودة للرئيسية
          </Link>
          <div className="mb-8 md:hidden">
            <span className="font-display text-2xl font-bold text-gold">فُرقان</span>
            <p className="text-xs text-muted">FURQAN Academy</p>
          </div>
          <div className="rounded-xl border border-surface-border bg-surface p-8">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
