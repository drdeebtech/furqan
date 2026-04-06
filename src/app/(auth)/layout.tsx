import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { CheckCircle } from "lucide-react";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

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
          <Link href="/" className="flex items-center gap-3">
            <Image src="/logo-192.png" alt="فرقان" width={48} height={48} className="rounded-full" priority />
            <span className="font-display text-4xl font-bold text-gold">فُرقان</span>
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
            العودة للرئيسية →
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
