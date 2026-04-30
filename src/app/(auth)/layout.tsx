import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { CheckCircle } from "lucide-react";
import { getT } from "@/lib/i18n/server";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { t, dir, lang } = await getT();
  return (
    <div dir={dir} className="flex min-h-screen">
      {/* Branding panel — islamic-pattern background reads premium-traditional
          and matches the marketing-side hero treatment. */}
      <aside className="islamic-pattern relative hidden flex-col justify-center border-e border-[var(--surface-border)] p-12 md:flex md:w-1/2">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-background/30 via-transparent to-background/40" aria-hidden="true" />
        <div className="relative mx-auto max-w-sm">
          <Link href="/" className="inline-flex items-center gap-3 focus-ring rounded-lg" aria-label={t("الصفحة الرئيسية", "Home")}>
            <Image src="/logo-192.png" alt="فرقان" width={48} height={48} className="rounded-full ring-2 ring-gold/30" priority />
            <span className="font-display text-4xl font-bold text-gold">فُرقان</span>
          </Link>
          <p className="mt-3 text-lg">{t("أكاديمية القرآن الكريم", "Online Quran Academy")}</p>
          <p className="mt-1 text-sm text-muted">FURQAN Online Quran Academy</p>

          <div className="my-8 h-px bg-gold/20" />

          <ul className="space-y-4" aria-label={t("ما يميّزنا", "What sets us apart")}>
            {[
              { ar: "معلمون حاصلون على الإجازة", en: "Certified teachers" },
              { ar: "جلسات مرنة عبر الفيديو", en: "Flexible video sessions" },
              { ar: "تتبع تقدمك في الحفظ", en: "Track your memorization progress" },
            ].map((f) => (
              <li key={f.en} className="flex items-start gap-3">
                <CheckCircle size={18} className="mt-0.5 shrink-0 text-gold" aria-hidden="true" />
                <div>
                  <p className="text-sm font-medium">{lang === "ar" ? f.ar : f.en}</p>
                  {lang === "ar" && <p className="text-xs text-muted">{f.en}</p>}
                </div>
              </li>
            ))}
          </ul>

          <p className="mt-12 font-display text-sm leading-relaxed text-gold/70">
            ﴿ وَمَن يَتَّقِ اللَّهَ يَجْعَل لَّهُ مَخْرَجًا ﴾
          </p>
        </div>
      </aside>

      {/* Form panel */}
      <main className="flex w-full flex-col justify-center px-4 py-12 md:w-1/2 md:px-12" id="auth-main">
        <div className="mx-auto w-full max-w-md">
          <Link
            href="/"
            className="mb-6 inline-flex items-center gap-1.5 text-sm text-gold transition-colors hover:text-gold-light focus-ring rounded-lg"
          >
            <span aria-hidden="true">{dir === "rtl" ? "→" : "←"}</span>
            {t("العودة للرئيسية", "Back to Home")}
          </Link>
          <div className="mb-8 md:hidden">
            <Link href="/" className="inline-flex items-baseline gap-2 focus-ring rounded-lg" aria-label={t("الصفحة الرئيسية", "Home")}>
              <span className="font-display text-2xl font-bold text-gold">فُرقان</span>
              <span className="text-xs text-muted">FURQAN Academy</span>
            </Link>
          </div>
          <div className="rounded-2xl glass-card p-8">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
