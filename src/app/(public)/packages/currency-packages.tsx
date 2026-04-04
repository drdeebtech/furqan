"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle } from "lucide-react";

const CURRENCIES = [
  { code: "USD", symbol: "$", label: "USD ($)" },
  { code: "GBP", symbol: "£", label: "GBP (£)" },
  { code: "SAR", symbol: "ر.س", label: "SAR (ر.س)" },
  { code: "AUD", symbol: "A$", label: "AUD (A$)" },
];

const PACKAGES = [
  {
    name: "الباقة الأساسية",
    en: "Starter",
    freq: "٢ أيام / أسبوع · ٨ جلسات / شهر",
    dur: "30 دقيقة / جلسة",
    prices: { USD: 40, GBP: 25, SAR: 150, AUD: 55 },
    features: ["قراءة القرآن", "أحكام التجويد الأساسية", "الصلوات والأدعية", "تقرير تقدم شهري"],
  },
  {
    name: "الباقة المتوسطة",
    en: "Standard",
    freq: "٣ أيام / أسبوع · ١٢ جلسة / شهر",
    dur: "30-45 دقيقة / جلسة",
    prices: { USD: 50, GBP: 30, SAR: 185, AUD: 65 },
    features: ["كل مزايا الأساسية", "حفظ سور قصيرة", "مراجعة منتظمة", "تقرير أسبوعي"],
  },
  {
    name: "الباقة المتقدمة",
    en: "Premium",
    freq: "٥ أيام / أسبوع · ٢٠ جلسة / شهر",
    dur: "45-60 دقيقة / جلسة",
    prices: { USD: 65, GBP: 40, SAR: 245, AUD: 85 },
    featured: true,
    features: ["كل مزايا المتوسطة", "برنامج حفظ متكامل", "تجويد متقدم", "تقرير يومي", "أولوية في اختيار المعلم"],
  },
  {
    name: "باقة نهاية الأسبوع",
    en: "Weekend",
    freq: "السبت والأحد · ٨ جلسات / شهر",
    dur: "30-60 دقيقة / جلسة",
    prices: { USD: 60, GBP: 35, SAR: 225, AUD: 70 },
    features: ["جلسات في عطلة الأسبوع فقط", "مرونة كاملة في التوقيت", "مثالية للعاملين وأولياء الأمور", "تقرير أسبوعي"],
  },
];

/**
 * Renders a responsive pricing section with currency selection tabs and a grid of subscription package cards.
 *
 * The displayed package prices and currency symbol update when a different currency tab is selected. Featured
 * packages receive distinct styling and a badge; each card includes package metadata, a feature list, and a CTA
 * link that navigates to the contact page with the package identifier.
 *
 * @returns The JSX element for the currency-selectable packages pricing section.
 */
export function CurrencyPackages() {
  const [currency, setCurrency] = useState<"USD" | "GBP" | "SAR" | "AUD">("USD");
  const curr = CURRENCIES.find((c) => c.code === currency)!;

  return (
    <section className="py-24">
      <div className="mx-auto max-w-6xl px-6">
        {/* Currency tabs */}
        <div className="mb-12 flex flex-wrap justify-center gap-2">
          {CURRENCIES.map((c) => (
            <button
              key={c.code}
              onClick={() => setCurrency(c.code as typeof currency)}
              className={`rounded-full px-4 py-2 text-sm transition-colors ${
                currency === c.code
                  ? "bg-gold text-background font-medium"
                  : "border border-card-border text-muted hover:border-gold/40 hover:text-gold"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* Package cards */}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {PACKAGES.map((pkg) => (
            <div
              key={pkg.en}
              className={`flex flex-col rounded-2xl p-6 ${
                pkg.featured ? "border-2 border-gold bg-card" : "border border-card-border bg-card"
              }`}
            >
              {pkg.featured && (
                <span className="mb-3 inline-block self-start rounded-full bg-gold px-3 py-1 text-xs font-bold text-background">
                  الأكثر طلباً
                </span>
              )}
              <h3 className="text-lg font-bold">{pkg.name}</h3>
              <p className="text-xs text-muted">{pkg.en}</p>
              <p className="font-display mt-3 text-3xl font-bold text-gold">
                {curr.symbol}{pkg.prices[currency]}
                <span className="text-sm font-normal text-muted"> /شهر</span>
              </p>
              <p className="mt-1 text-xs text-muted">{pkg.freq}</p>
              <p className="text-xs text-muted">{pkg.dur}</p>

              <ul className="mt-4 flex-1 space-y-2">
                {pkg.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm">
                    <CheckCircle size={14} className="mt-0.5 shrink-0 text-gold" />
                    <span className="text-muted">{f}</span>
                  </li>
                ))}
              </ul>

              <Link
                href={`/contact?package=${pkg.en}`}
                className={`mt-6 block rounded py-2.5 text-center text-sm font-medium transition-colors ${
                  pkg.featured
                    ? "bg-gold text-background hover:bg-gold-hover"
                    : "border border-gold bg-gold/10 text-gold hover:bg-gold hover:text-background"
                }`}
              >
                احجز الآن
              </Link>
              <p className="mt-2 text-center text-xs text-muted">جلسة تجريبية مجانية متاحة</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
