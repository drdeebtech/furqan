"use client";

import { Clock, TrendingUp } from "lucide-react";
import { useLang } from "@/lib/i18n/context";

export interface TeachingHoursViewProps {
  thisWeekMinutes: number;
  thisMonthMinutes: number;
  byTypeThisMonth: Record<string, number>;
  daily: Array<{ date: string; minutes: number }>;
}

const SESSION_TYPE_LABEL: Record<string, { ar: string; en: string }> = {
  hifz: { ar: "حفظ", en: "Hifz" },
  muraja: { ar: "مراجعة", en: "Review" },
  tajweed: { ar: "تجويد", en: "Tajweed" },
  tilawa: { ar: "تلاوة", en: "Tilawa" },
  qiraat: { ar: "قراءات", en: "Qira'at" },
  tafsir: { ar: "تفسير", en: "Tafsir" },
  combined: { ar: "حفظ + مراجعة", en: "Hifz + Review" },
  other: { ar: "أخرى", en: "Other" },
};

const SESSION_TYPE_COLOR: Record<string, string> = {
  hifz: "#F59E0B",
  muraja: "#10B981",
  tajweed: "#8B5CF6",
  tilawa: "#3B82F6",
  qiraat: "#06B6D4",
  tafsir: "#EC4899",
  combined: "#84CC16",
  other: "#94A3B8",
};

function formatHoursMinutes(
  minutes: number,
  lang: "ar" | "en",
): string {
  if (minutes === 0) return lang === "ar" ? "٠ ساعة" : "0h";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (lang === "ar") {
    if (h === 0) return `${m} د`;
    if (m === 0) return `${h} ساعة`;
    return `${h} س ${m} د`;
  }
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function TeachingHoursView({
  thisWeekMinutes,
  thisMonthMinutes,
  byTypeThisMonth,
  daily,
}: TeachingHoursViewProps) {
  const { t, lang } = useLang();
  const langKey: "ar" | "en" = lang === "ar" ? "ar" : "en";

  const breakdown = Object.entries(byTypeThisMonth)
    .filter(([, m]) => m > 0)
    .sort((a, b) => b[1] - a[1]);

  const maxDaily = Math.max(1, ...daily.map((d) => d.minutes));
  const localeArg = langKey === "ar" ? "ar" : "en-US";

  return (
    <div className="mt-6 space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="glass-card p-5">
          <div className="flex items-center gap-2 text-sm text-muted">
            <Clock size={14} aria-hidden="true" />
            {t("هذا الأسبوع", "This week")}
          </div>
          <p className="mt-1 font-display text-3xl font-bold tabular-nums">
            {formatHoursMinutes(thisWeekMinutes, langKey)}
          </p>
          <p className="mt-1 text-xs text-muted-light">
            {t("آخر ٧ أيام", "Last 7 days")}
          </p>
        </div>
        <div className="glass-card p-5">
          <div className="flex items-center gap-2 text-sm text-muted">
            <TrendingUp size={14} aria-hidden="true" />
            {t("هذا الشهر", "This month")}
          </div>
          <p className="mt-1 font-display text-3xl font-bold tabular-nums">
            {formatHoursMinutes(thisMonthMinutes, langKey)}
          </p>
          <p className="mt-1 text-xs text-muted-light">
            {t("آخر ٣٠ يوماً", "Last 30 days")}
          </p>
        </div>
      </div>

      {breakdown.length > 0 && (
        <section className="glass-card p-5">
          <h2 className="mb-3 font-display text-base font-semibold">
            {t("توزيع الجلسات هذا الشهر", "Session-type breakdown · this month")}
          </h2>
          <ul className="space-y-2">
            {breakdown.map(([type, mins]) => {
              const pct = Math.round((mins / thisMonthMinutes) * 100);
              const label =
                SESSION_TYPE_LABEL[type] ??
                ({ ar: type, en: type } as { ar: string; en: string });
              const color = SESSION_TYPE_COLOR[type] ?? "#94A3B8";
              return (
                <li key={type} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2">
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ background: color }}
                      />
                      {t(label.ar, label.en)}
                    </span>
                    <span className="text-xs tabular-nums text-muted">
                      {formatHoursMinutes(mins, langKey)} · {pct}%
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-card-border/50">
                    <div
                      className="h-full"
                      style={{ width: `${pct}%`, background: color }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="glass-card p-5">
        <h2 className="mb-3 font-display text-base font-semibold">
          {t("التوزيع اليومي", "Daily breakdown · last 30 days")}
        </h2>
        <div className="flex h-32 items-end gap-0.5">
          {daily.map((d) => {
            const heightPct = (d.minutes / maxDaily) * 100;
            return (
              // h-full on the column wrapper so the inner bar's
              // `height: ${heightPct}%` resolves against the parent's 128px
              // (h-32) instead of the column's intrinsic 0. Without h-full,
              // the bar collapses to a sliver — caught in the 2026-05-06
              // visual audit.
              <div
                key={d.date}
                className="group relative h-full flex-1 flex items-end"
                title={`${new Date(d.date).toLocaleDateString(localeArg, {
                  month: "short",
                  day: "numeric",
                })} — ${formatHoursMinutes(d.minutes, langKey)}`}
              >
                <div
                  className="w-full rounded-t bg-gold/40 transition-colors group-hover:bg-gold/80"
                  style={{
                    height: `${heightPct}%`,
                    minHeight: d.minutes > 0 ? "2px" : "0",
                  }}
                />
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
