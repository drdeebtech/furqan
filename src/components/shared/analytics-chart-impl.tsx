"use client";

import { useState, useRef } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Cell,
  LabelList,
} from "recharts";
import { useLang } from "@/lib/i18n/context";

interface ChartDataPoint {
  day: string;
  value: number;
  isActive: boolean;
}

interface AnalyticsChartProps {
  data: ChartDataPoint[];
  title: string;
  unit?: string;
  /** Optional Daily dataset; if omitted, the Daily tab shows "coming soon". */
  dailyData?: ChartDataPoint[];
  /** Optional Monthly dataset; if omitted, the Monthly tab shows "coming soon". */
  monthlyData?: ChartDataPoint[];
}

export function AnalyticsChart({
  data,
  title: _title,
  unit = "h",
  dailyData,
  monthlyData,
}: AnalyticsChartProps) {
  const { t } = useLang();
  const [activeTab, setActiveTab] = useState(1);
  const [toast, setToast] = useState<number | null>(null);
  const tabsRef = useRef<(HTMLButtonElement | null)[]>([]);

  const datasets: (ChartDataPoint[] | undefined)[] = [dailyData, data, monthlyData];

  const handleTab = (i: number) => {
    if (datasets[i]) { setActiveTab(i); return; }
    // Fallback for callers that haven't wired daily/monthly yet
    setToast(i);
    setTimeout(() => setToast(null), 2000);
  };

  const visibleData = datasets[activeTab] ?? data;

  const tabs = [
    { label: t("يومي", "Daily"), i: 0 },
    { label: t("أسبوعي", "Weekly"), i: 1 },
    { label: t("شهري", "Monthly"), i: 2 },
  ];

  const fmt = (v: number) => {
    if (unit === "$") return `$${v}`;
    if (unit === "#") return `${v}`;
    return `${v}h`;
  };

  function Tooltip(props: { x?: string | number; y?: string | number; width?: string | number; value?: string | number; index?: number }) {
    const entry = visibleData[props.index ?? 0];
    if (!entry?.isActive || !entry.value) return null;
    const cx = Number(props.x ?? 0) + Number(props.width ?? 0) / 2;
    const cy = Number(props.y ?? 0) - 22;
    const label = `🔥 ${fmt(Number(props.value ?? 0))}`;
    return (
      <g>
        <rect x={cx - 40} y={cy - 13} width="80" height="26" rx="13" fill="var(--foreground)" />
        <text x={cx} y={cy + 5} textAnchor="middle" fill="var(--background)" fontSize="12" fontWeight="600">
          {label}
        </text>
      </g>
    );
  }

  return (
    <div>
      {/* Tabs — Daily | Weekly | Monthly. Active state uses surface tokens
          so the tab inverts cleanly between dark and light themes. */}
      <div
        role="tablist"
        aria-label={t("الفترات الزمنية", "Time periods")}
        className="relative inline-flex gap-0 rounded-[10px] bg-[var(--surface-light)] p-1"
        onKeyDown={(e) => {
          const currentIndex = tabs.findIndex(t => t.i === activeTab);
          let nextIndex = currentIndex;
          if (e.key === "ArrowRight") {
            nextIndex = (currentIndex + 1) % tabs.length;
          } else if (e.key === "ArrowLeft") {
            nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
          } else {
            return;
          }
          e.preventDefault();
          handleTab(tabs[nextIndex].i);
          tabsRef.current[nextIndex]?.focus();
        }}
      >
        {tabs.map((tab) => (
          <button
            key={tab.i}
            ref={(el) => { tabsRef.current[tabs.findIndex(t => t.i === tab.i)] = el; }}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.i}
            tabIndex={activeTab === tab.i ? 0 : -1}

            onClick={() => handleTab(tab.i)}
            className={`focus-ring relative rounded-md px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
              activeTab === tab.i
                ? "bg-[var(--card)] text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
                : "text-muted hover:text-foreground"
            }`}
          >
            {tab.label}
            {toast === tab.i && (
              <span className="absolute -bottom-8 start-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-lg bg-[var(--foreground)] px-2.5 py-1 text-[11px] text-[var(--background)] shadow-lg">
                {t("قريباً", "Coming soon")}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Chart */}
      <div className="mt-4">
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={visibleData} barCategoryGap="14%">
            <defs>
              {/* Inactive bar uses a translucent surface-divider tone so it
                  reads as restrained both on light cream and dark surfaces. */}
              <pattern
                id="hatch"
                patternUnits="userSpaceOnUse"
                width="8"
                height="8"
                patternTransform="rotate(45)"
              >
                <rect width="8" height="8" fill="var(--surface-divider)" fillOpacity="0.5" />
                <line x1="0" y1="0" x2="0" y2="8" stroke="var(--surface-light)" strokeWidth="1" strokeOpacity="0.6" />
              </pattern>
              <linearGradient id="activeGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent-purple)" />
                <stop offset="100%" stopColor="var(--accent-purple)" />
              </linearGradient>
            </defs>
            <CartesianGrid
              vertical={false}
              stroke="var(--surface-divider)"
              strokeDasharray="0"
            />
            <XAxis
              dataKey="day"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 13, fill: "var(--muted)" }}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 12, fill: "var(--muted-light)" }}
              tickFormatter={fmt}
              domain={[0, unit === "h" ? 24 : "auto"]}
              ticks={unit === "h" ? [0, 6, 12, 18, 24] : undefined}
              allowDecimals={unit !== "#"}
            />
            <Bar dataKey="value" maxBarSize={48} radius={[8, 8, 0, 0]}>
              {visibleData.map((entry) => (
                <Cell
                  key={entry.day}
                  fill={entry.isActive ? "url(#activeGrad)" : "url(#hatch)"}
                  fillOpacity={1}
                  stroke={entry.isActive ? "rgba(255,255,255,0.25)" : "transparent"}
                  strokeWidth={entry.isActive ? 1 : 0}
                />
              ))}
              <LabelList dataKey="value" position="top" content={Tooltip as never} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
