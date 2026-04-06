"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { useFeatureFlags } from "@/lib/feature-flags-context";

const CURRENCIES = [
  { code: "USD", symbol: "$", label: "USD ($)" },
  { code: "GBP", symbol: "£", label: "GBP (£)" },
  { code: "SAR", symbol: "ر.س", label: "SAR (ر.س)" },
  { code: "AUD", symbol: "A$", label: "AUD (A$)" },
];

const PACKAGES = [
  {
    ar: "الباقة الأساسية", en: "Starter",
    freqAr: "٢ أيام / أسبوع · ٨ جلسات / شهر", freqEn: "2 days/week · 8 sessions/month",
    durAr: "30 دقيقة / جلسة", durEn: "30 min/session",
    prices: { USD: 40, GBP: 25, SAR: 150, AUD: 55 },
    fAr: ["قراءة القرآن", "أحكام التجويد الأساسية", "الصلوات والأدعية", "تقرير تقدم شهري"],
    fEn: ["Quran reading", "Basic Tajweed rules", "Prayers and Duas", "Monthly progress report"],
  },
  {
    ar: "الباقة المتوسطة", en: "Standard",
    freqAr: "٣ أيام / أسبوع · ١٢ جلسة / شهر", freqEn: "3 days/week · 12 sessions/month",
    durAr: "30-45 دقيقة / جلسة", durEn: "30-45 min/session",
    prices: { USD: 50, GBP: 30, SAR: 185, AUD: 65 },
    fAr: ["كل مزايا الأساسية", "حفظ سور قصيرة", "مراجعة منتظمة", "تقرير أسبوعي"],
    fEn: ["All Starter features", "Short surah memorization", "Regular revision", "Weekly report"],
  },
  {
    ar: "الباقة المتقدمة", en: "Premium",
    freqAr: "٥ أيام / أسبوع · ٢٠ جلسة / شهر", freqEn: "5 days/week · 20 sessions/month",
    durAr: "45-60 دقيقة / جلسة", durEn: "45-60 min/session",
    prices: { USD: 65, GBP: 40, SAR: 245, AUD: 85 },
    featured: true,
    fAr: ["كل مزايا المتوسطة", "برنامج حفظ متكامل", "تجويد متقدم", "تقرير يومي", "أولوية في اختيار المعلم"],
    fEn: ["All Standard features", "Full memorization program", "Advanced Tajweed", "Daily report", "Priority teacher selection"],
  },
  {
    ar: "باقة نهاية الأسبوع", en: "Weekend",
    freqAr: "السبت والأحد · ٨ جلسات / شهر", freqEn: "Sat & Sun · 8 sessions/month",
    durAr: "30-60 دقيقة / جلسة", durEn: "30-60 min/session",
    prices: { USD: 60, GBP: 35, SAR: 225, AUD: 70 },
    fAr: ["جلسات في عطلة الأسبوع فقط", "مرونة كاملة في التوقيت", "مثالية للعاملين وأولياء الأمور", "تقرير أسبوعي"],
    fEn: ["Weekend sessions only", "Full schedule flexibility", "Perfect for working parents", "Weekly report"],
  },
];

export function CurrencyPackages() {
  const [currency, setCurrency] = useState<"USD" | "GBP" | "SAR" | "AUD">("USD");
  const { t } = useLang();
  const { hidePrices } = useFeatureFlags();
  const curr = CURRENCIES.find((c) => c.code === currency)!;

  return (
    <section className="py-24">
      <div className="mx-auto max-w-6xl px-6">
        {!hidePrices && (
          <div className="mb-12 flex flex-wrap justify-center gap-2">
            {CURRENCIES.map((c) => (
              <button
                key={c.code}
                onClick={() => setCurrency(c.code as typeof currency)}
                className={`rounded-full px-4 py-2 text-sm transition-colors ${
                  currency === c.code ? "bg-gold font-medium text-background" : "border border-card-border text-muted hover:border-gold/40 hover:text-gold"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {PACKAGES.map((pkg) => (
            <div key={pkg.en} className={`flex flex-col rounded-2xl p-6 ${pkg.featured ? "border-2 border-gold bg-card" : "border border-card-border bg-card"}`}>
              {pkg.featured && (
                <span className="mb-3 inline-block self-start rounded-full bg-gold px-3 py-1 text-xs font-bold text-background">
                  {t("الأكثر طلباً", "Most Popular")}
                </span>
              )}
              <h3 className="text-lg font-bold">{t(pkg.ar, pkg.en)}</h3>
              {hidePrices ? (
                <p className="font-display mt-3 text-3xl font-bold text-gold">
                  {t("مجاناً", "Free")}
                  <span className="mr-2 text-sm font-normal text-muted">{t("لفترة محدودة", "limited time")}</span>
                </p>
              ) : (
                <p className="font-display mt-3 text-3xl font-bold text-gold">
                  {curr.symbol}{pkg.prices[currency]}
                  <span className="text-sm font-normal text-muted"> {t("/شهر", "/mo")}</span>
                </p>
              )}
              <p className="mt-1 text-xs text-muted">{t(pkg.freqAr, pkg.freqEn)}</p>
              <p className="text-xs text-muted">{t(pkg.durAr, pkg.durEn)}</p>

              <ul className="mt-4 flex-1 space-y-2">
                {(t(pkg.fAr.join("|||"), pkg.fEn.join("|||"))).split("|||").map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm">
                    <CheckCircle size={14} className="mt-0.5 shrink-0 text-gold" />
                    <span className="text-muted">{f}</span>
                  </li>
                ))}
              </ul>

              <Link
                href={`/contact?package=${pkg.en}`}
                className={`mt-6 block rounded py-2.5 text-center text-sm font-medium transition-colors ${
                  pkg.featured ? "bg-gold text-background hover:bg-gold-hover" : "border border-gold bg-gold/10 text-gold hover:bg-gold hover:text-background"
                }`}
              >
                {t("احجز الآن", "Book Now")}
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
