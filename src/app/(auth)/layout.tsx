import Link from "next/link";
import { CheckCircle } from "lucide-react";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div dir="rtl" className="flex min-h-screen">
      {/* Left panel — branding (hidden on mobile) */}
      <div className="hidden flex-col justify-center border-l border-card-border bg-card p-12 md:flex md:w-1/2">
        <div className="mx-auto max-w-sm">
          <Link href="/" className="text-4xl font-bold text-gold">
            فُرقان
          </Link>
          <p className="mt-2 text-xl">أكاديمية القرآن الكريم</p>
          <p className="mt-1 text-sm text-muted">
            FURQAN Online Quran Academy
          </p>

          <div className="my-8 h-px bg-card-border" />

          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <CheckCircle size={18} className="mt-0.5 shrink-0 text-gold" />
              <div>
                <p className="text-sm font-medium">معلمون حاصلون على الإجازة</p>
                <p className="text-xs text-muted">Certified teachers</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <CheckCircle size={18} className="mt-0.5 shrink-0 text-gold" />
              <div>
                <p className="text-sm font-medium">جلسات مرنة عبر الفيديو</p>
                <p className="text-xs text-muted">Flexible video sessions</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <CheckCircle size={18} className="mt-0.5 shrink-0 text-gold" />
              <div>
                <p className="text-sm font-medium">تتبع تقدمك في الحفظ</p>
                <p className="text-xs text-muted">
                  Track your memorization progress
                </p>
              </div>
            </div>
          </div>

          <p className="mt-12 text-sm text-gold/40">
            ﴿ وَمَن يَتَّقِ اللَّهَ يَجْعَل لَّهُ مَخْرَجًا ﴾
          </p>
        </div>
      </div>

      {/* Right panel — form */}
      <div className="flex w-full flex-col justify-center px-4 py-12 md:w-1/2 md:px-12">
        <div className="mx-auto w-full max-w-md">
          <Link
            href="/"
            className="mb-6 inline-block text-sm text-gold transition-colors hover:text-gold-hover"
          >
            ← العودة للرئيسية
          </Link>

          {/* Mobile-only branding */}
          <div className="mb-8 md:hidden">
            <span className="text-2xl font-bold text-gold">فُرقان</span>
            <p className="text-xs text-muted">FURQAN Academy</p>
          </div>

          <div className="rounded-2xl border border-card-border bg-card p-8">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
