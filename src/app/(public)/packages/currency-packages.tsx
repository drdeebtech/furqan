"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { useFeatureFlags } from "@/lib/feature-flags-context";
import { PayPalBuyButton } from "@/components/shared/paypal-buy-button";
import type { Package } from "@/types/database";

const CURRENCIES = [
  { code: "USD", symbol: "$", label: "USD ($)", field: "price_usd" as const },
  { code: "GBP", symbol: "£", label: "GBP (£)", field: "price_gbp" as const },
  { code: "SAR", symbol: "ر.س", label: "SAR (ر.س)", field: "price_sar" as const },
  { code: "AUD", symbol: "A$", label: "AUD (A$)", field: "price_aud" as const },
];

type CurrencyField = "price_usd" | "price_gbp" | "price_sar" | "price_aud";

interface CurrencyPackagesProps {
  packages: Package[];
  paypalEnabled?: boolean;
  isAuthenticated?: boolean;
}

export function CurrencyPackages({ packages, paypalEnabled = false, isAuthenticated = false }: CurrencyPackagesProps) {
  const [currency, setCurrency] = useState<CurrencyField>("price_usd");
  const { t } = useLang();
  const { hidePrices } = useFeatureFlags();
  const curr = CURRENCIES.find((c) => c.field === currency)!;
  // PayPal button replaces the contact CTA only when feature flag is on AND
  // a student is signed in. Anyone else (signed-out browsers, flag-off) keeps
  // the existing "Book Now → /contact" path so the page never regresses.
  const showPaypal = paypalEnabled && isAuthenticated;

  // Fallback to hardcoded if no packages from DB
  if (packages.length === 0) {
    return (
      <section className="py-24">
        <div className="mx-auto max-w-6xl px-6 text-center text-muted">
          {t("لا توجد باقات متاحة حالياً", "No packages available at the moment")}
        </div>
      </section>
    );
  }

  return (
    <section className="py-24">
      <div className="mx-auto max-w-6xl px-6">
        {!hidePrices && (
          <div className="mb-12 flex flex-wrap justify-center gap-2">
            {CURRENCIES.map((c) => (
              <button
                key={c.code}
                onClick={() => setCurrency(c.field)}
                className={`rounded-full px-4 py-2 text-sm transition-colors ${
                  currency === c.field ? "glass-gold glass-pill font-medium" : "glass glass-pill text-muted hover:border-gold/40 hover:text-gold"
                }`}
              >
                <span dir="ltr">{c.symbol} {c.code}</span>
              </button>
            ))}
          </div>
        )}

        <div className={`grid gap-6 md:grid-cols-2 ${packages.length >= 4 ? "lg:grid-cols-4" : packages.length === 3 ? "lg:grid-cols-3" : ""}`}>
          {packages.map((pkg) => {
            const price = pkg[currency] ?? pkg.price_usd;
            const features = t(
              (pkg.features_ar ?? []).join("|||"),
              (pkg.features ?? []).join("|||"),
            ).split("|||").filter(Boolean);

            return (
              <div key={pkg.id} className={`flex flex-col glass-card p-6 ${pkg.is_featured ? "border-2 border-gold" : ""}`}>
                {pkg.is_featured && (
                  <span className="glass-gold glass-pill mb-3 inline-block self-start px-3 py-1 text-xs font-bold">
                    {t("الأكثر طلباً", "Most Popular")}
                  </span>
                )}
                <h3 className="text-lg font-bold">{t(pkg.name_ar ?? pkg.name, pkg.name)}</h3>
                {hidePrices ? (
                  <p className="font-display mt-3 text-3xl font-bold text-gold">
                    {t("مجاناً", "Free")}
                    <span className="me-2 text-sm font-normal text-muted">{t("لفترة محدودة", "limited time")}</span>
                  </p>
                ) : (
                  <p className="font-display mt-3 text-3xl font-bold text-gold">
                    {curr.symbol}{price}
                    {pkg.session_count > 1 && <span className="text-sm font-normal text-muted"> {t("/شهر", "/mo")}</span>}
                  </p>
                )}
                <p className="mt-1 text-xs text-muted">
                  {t(pkg.description_ar ?? "", pkg.description ?? "")}
                </p>
                <p className="text-xs text-muted">
                  {pkg.session_count} {t("جلسات", "sessions")} · {pkg.duration_min} {t("دقيقة", "min")}
                </p>

                <ul className="mt-4 flex-1 space-y-2">
                  {features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <CheckCircle size={14} className="mt-0.5 shrink-0 text-gold" />
                      <span className="text-muted">{f}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-6">
                  {showPaypal ? (
                    <PayPalBuyButton packageId={pkg.id} currency={curr.code as "USD" | "GBP" | "SAR" | "AUD"} />
                  ) : (
                    <Link
                      href={`/contact?package=${pkg.name}`}
                      className={`block rounded-full py-2.5 text-center text-sm font-medium transition-colors ${
                        pkg.is_featured ? "glass-gold glass-pill hover:bg-gold-hover" : "glass glass-pill text-gold hover:bg-gold hover:text-background"
                      }`}
                    >
                      {t("احجز الآن", "Book Now")}
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
