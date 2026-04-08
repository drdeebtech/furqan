"use client";

import { useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
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

export function AnalyticsChart({ data, title: _title, unit = "Hours" }: AnalyticsChartProps) {
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
              tickFormatter={(v: number) => `${v}h`}
              domain={[0, "auto"]}
            />
            <Tooltip
              cursor={false}
              content={({ active, payload }) => {
                if (!active || !payload?.[0]) return null;
                return (
                  <div className="rounded-[10px] bg-[#1A1A1F] px-3 py-2 text-xs text-white shadow-lg">
                    🔥 {payload[0].value} {unit}
                  </div>
                );
              }}
            />
            <Bar dataKey="value" maxBarSize={44} radius={[8, 8, 8, 8]}>
              {data.map((entry, index) => (
                <Cell
                  key={index}
                  fill={entry.isActive ? "#7C5CFF" : "#F0F0F2"}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
