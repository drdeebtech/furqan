"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useLang } from "@/lib/i18n/context";

const RISK_OPTIONS = [
  { value: "all", ar: "كل المستويات", en: "All levels" },
  { value: "critical", ar: "حرج (≥75)", en: "Critical (≥75)" },
  { value: "high", ar: "مرتفع (60-74)", en: "High (60-74)" },
  { value: "medium", ar: "متوسط (40-59)", en: "Medium (40-59)" },
  { value: "low", ar: "منخفض (<40)", en: "Low (<40)" },
];

const PKG_OPTIONS = [
  { value: "all", ar: "كل الباقات", en: "All packages" },
  { value: "active", ar: "لديه باقة نشطة", en: "Has active package" },
  { value: "low", ar: "رصيد منخفض (≤2)", en: "Low balance (≤2)" },
  { value: "expiring", ar: "تنتهي خلال 7 أيام", en: "Expires within 7 days" },
  { value: "none", ar: "بدون باقة", en: "No package" },
];

const CONTACTED_OPTIONS = [
  { value: "all", ar: "كل الحالات", en: "All statuses" },
  { value: "never", ar: "لم يُتواصل", en: "Never contacted" },
  { value: "recent", ar: "تم التواصل (<7 أيام)", en: "Contacted (<7d)" },
  { value: "stale", ar: "تواصل قديم (≥7 أيام)", en: "Stale contact (≥7d)" },
];

export function RetentionFilters() {
  return (
    <Suspense fallback={null}>
      <RetentionFiltersInner />
    </Suspense>
  );
}

function RetentionFiltersInner() {
  const { t, lang } = useLang();
  const label = (o: { ar: string; en: string }) => (lang === "ar" ? o.ar : o.en);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const current = {
    risk: params.get("risk") ?? "all",
    pkg: params.get("pkg") ?? "all",
    contacted: params.get("contacted") ?? "all",
  };

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value === "all") next.delete(key);
    else next.set(key, value);
    router.push(`${pathname}?${next.toString()}`);
  }

  const hasActiveFilter = current.risk !== "all" || current.pkg !== "all" || current.contacted !== "all";

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl glass-card p-3 text-xs">
      <select
        value={current.risk}
        onChange={(e) => setParam("risk", e.target.value)}
        className="glass-input rounded px-2 py-1 text-foreground"
        aria-label={t("تصفية حسب مستوى الخطر", "Filter by risk level")}
      >
        {RISK_OPTIONS.map(o => <option key={o.value} value={o.value}>{label(o)}</option>)}
      </select>
      <select
        value={current.pkg}
        onChange={(e) => setParam("pkg", e.target.value)}
        className="glass-input rounded px-2 py-1 text-foreground"
        aria-label={t("تصفية حسب حالة الباقة", "Filter by package status")}
      >
        {PKG_OPTIONS.map(o => <option key={o.value} value={o.value}>{label(o)}</option>)}
      </select>
      <select
        value={current.contacted}
        onChange={(e) => setParam("contacted", e.target.value)}
        className="glass-input rounded px-2 py-1 text-foreground"
        aria-label={t("تصفية حسب التواصل", "Filter by contact status")}
      >
        {CONTACTED_OPTIONS.map(o => <option key={o.value} value={o.value}>{label(o)}</option>)}
      </select>
      {hasActiveFilter && (
        <button
          type="button"
          onClick={() => router.push(pathname)}
          className="text-gold hover:text-gold-hover"
        >
          {t("مسح التصفية", "Clear filters")}
        </button>
      )}
    </div>
  );
}
