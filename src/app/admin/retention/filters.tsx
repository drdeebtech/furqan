"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";

const RISK_OPTIONS = [
  { value: "all", ar: "كل المستويات" },
  { value: "critical", ar: "حرج (≥75)" },
  { value: "high", ar: "مرتفع (60-74)" },
  { value: "medium", ar: "متوسط (40-59)" },
  { value: "low", ar: "منخفض (<40)" },
];

const PKG_OPTIONS = [
  { value: "all", ar: "كل الباقات" },
  { value: "active", ar: "لديه باقة نشطة" },
  { value: "low", ar: "رصيد منخفض (≤2)" },
  { value: "expiring", ar: "تنتهي خلال 7 أيام" },
  { value: "none", ar: "بدون باقة" },
];

const CONTACTED_OPTIONS = [
  { value: "all", ar: "كل الحالات" },
  { value: "never", ar: "لم يُتواصل" },
  { value: "recent", ar: "تم التواصل (<7 أيام)" },
  { value: "stale", ar: "تواصل قديم (≥7 أيام)" },
];

export function RetentionFilters() {
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
        aria-label="تصفية حسب مستوى الخطر"
      >
        {RISK_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.ar}</option>)}
      </select>
      <select
        value={current.pkg}
        onChange={(e) => setParam("pkg", e.target.value)}
        className="glass-input rounded px-2 py-1 text-foreground"
        aria-label="تصفية حسب حالة الباقة"
      >
        {PKG_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.ar}</option>)}
      </select>
      <select
        value={current.contacted}
        onChange={(e) => setParam("contacted", e.target.value)}
        className="glass-input rounded px-2 py-1 text-foreground"
        aria-label="تصفية حسب التواصل"
      >
        {CONTACTED_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.ar}</option>)}
      </select>
      {hasActiveFilter && (
        <button
          type="button"
          onClick={() => router.push(pathname)}
          className="text-gold hover:text-gold-hover"
        >
          مسح التصفية
        </button>
      )}
    </div>
  );
}
