"use client";

import { useState } from "react";
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
}

const TABS = ["Daily", "Weekly", "Monthly"] as const;
const TABS_AR = ["يومي", "أسبوعي", "شهري"] as const;

export function AnalyticsChart({ data, title: _title, unit = "h" }: AnalyticsChartProps) {
  const { t } = useLang();
  const [activeTab, setActiveTab] = useState<number>(1); // Weekly default
  const [tabTooltip, setTabTooltip] = useState<number | null>(null);

  const handleTabClick = (index: number) => {
    if (index === 1) {
      setActiveTab(index);
      return;
    }
    setTabTooltip(index);
    setTimeout(() => setTabTooltip(null), 2000);
  };

  const tabs = TABS.map((tab, i) => ({
    label: t(TABS_AR[i], tab),
    index: i,
  }));

  const formatValue = (v: number) => {
    if (unit === "$") return `$${v}`;
    if (unit === "#") return `${v}`;
    return `${v}h`;
  };

  function ActiveBarLabel(props: { x?: string | number; y?: string | number; width?: string | number; value?: string | number; index?: number }) {
    const entry = data[props.index ?? 0];
    if (!entry?.isActive || !entry.value) return null;
    const cx = Number(props.x ?? 0) + Number(props.width ?? 0) / 2;
    const cy = Number(props.y ?? 0) - 20;
    const label = `🔥 ${formatValue(Number(props.value ?? 0))}`;
    return (
      <g>
        <rect x={cx - 44} y={cy - 12} width="88" height="24" rx="12" fill="#1A1A1F" />
        <text x={cx} y={cy + 4} textAnchor="middle" fill="#FFF" fontSize="12" fontWeight="600">
          {label}
        </text>
      </g>
    );
  }

  return (
    <div>
      {/* Tabs */}
      <div className="relative flex gap-0 rounded-[10px] bg-[var(--surface-light,#F5F5F7)] p-1">
        {tabs.map((tab) => (
          <button
            key={tab.index}
            type="button"
            onClick={() => handleTabClick(tab.index)}
            className={`relative rounded-md px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
              activeTab === tab.index
                ? "bg-white text-[var(--foreground)] shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
                : "text-[var(--muted)] hover:text-[var(--foreground)]"
            }`}
          >
            {tab.label}
            {tabTooltip === tab.index && (
              <span className="absolute -bottom-8 start-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-lg bg-[#1A1A1F] px-2.5 py-1 text-[11px] text-white shadow-lg">
                {t("قريباً", "Coming soon")}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Chart */}
      <div className="mt-4">
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={data} barCategoryGap="20%">
            <defs>
              <pattern
                id="stripedPattern"
                patternUnits="userSpaceOnUse"
                width="8"
                height="8"
                patternTransform="rotate(45)"
              >
                <rect width="8" height="8" fill="var(--chart-stripe, #E5E5E0)" fillOpacity="0.6" />
                <line x1="0" y1="0" x2="0" y2="8" stroke="#D8D7D2" strokeWidth="1" />
              </pattern>
            </defs>
            <CartesianGrid
              vertical={false}
              stroke="var(--surface-divider, #F0F0F2)"
              strokeDasharray="0"
            />
            <XAxis
              dataKey="day"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 12, fill: "#6B7280" }}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: "#9CA3AF" }}
              tickFormatter={(v: number) => formatValue(v)}
              domain={[0, "auto"]}
            />
            <Bar dataKey="value" maxBarSize={48} radius={[8, 8, 0, 0]}>
              {data.map((entry, index) => (
                <Cell
                  key={index}
                  fill={entry.isActive ? "var(--accent-purple, #7C5CFF)" : "url(#stripedPattern)"}
                />
              ))}
              <LabelList dataKey="value" position="top" content={ActiveBarLabel as never} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
