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

export function AnalyticsChart({ data, title: _title, unit = "h" }: AnalyticsChartProps) {
  const { t } = useLang();
  const [activeTab, setActiveTab] = useState(1);
  const [toast, setToast] = useState<number | null>(null);

  const handleTab = (i: number) => {
    if (i === 1) { setActiveTab(i); return; }
    setToast(i);
    setTimeout(() => setToast(null), 2000);
  };

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
    const entry = data[props.index ?? 0];
    if (!entry?.isActive || !entry.value) return null;
    const cx = Number(props.x ?? 0) + Number(props.width ?? 0) / 2;
    const cy = Number(props.y ?? 0) - 22;
    const label = `🔥 ${fmt(Number(props.value ?? 0))}`;
    return (
      <g>
        <rect x={cx - 40} y={cy - 13} width="80" height="26" rx="13" fill="#1A1A1F" />
        <text x={cx} y={cy + 5} textAnchor="middle" fill="#FFF" fontSize="12" fontWeight="600">
          {label}
        </text>
      </g>
    );
  }

  return (
    <div>
      {/* Tabs — matches reference: Daily | Weekly | Monthly */}
      <div className="relative inline-flex gap-0 rounded-[10px] bg-[var(--surface-light,#F5F5F7)] p-1">
        {tabs.map((tab) => (
          <button
            key={tab.i}
            type="button"
            onClick={() => handleTab(tab.i)}
            className={`relative rounded-md px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
              activeTab === tab.i
                ? "bg-white text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
                : "text-muted hover:text-foreground"
            }`}
          >
            {tab.label}
            {toast === tab.i && (
              <span className="absolute -bottom-8 start-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-lg bg-[#1A1A1F] px-2.5 py-1 text-[11px] text-white shadow-lg">
                {t("قريباً", "Coming soon")}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Chart */}
      <div className="mt-4">
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data} barCategoryGap="14%">
            <defs>
              {/* Inactive bar: glass texture with crosshatch overlay */}
              <linearGradient id="inactiveGlass" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#E8E7E2" />
                <stop offset="30%" stopColor="#DDDCD7" />
                <stop offset="70%" stopColor="#D0CFC9" />
                <stop offset="100%" stopColor="#DDDCD7" />
              </linearGradient>
              <pattern
                id="hatch"
                patternUnits="userSpaceOnUse"
                width="5"
                height="5"
                patternTransform="rotate(45)"
              >
                <rect width="5" height="5" fill="url(#inactiveGlass)" />
                <line x1="0" y1="0" x2="0" y2="5" stroke="rgba(255,255,255,0.5)" strokeWidth="1" />
                <line x1="2.5" y1="0" x2="2.5" y2="5" stroke="rgba(0,0,0,0.06)" strokeWidth="0.5" />
              </pattern>
              {/* Active bar: intense 3D glass purple — visible in both light and dark */}
              <linearGradient id="activeGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#C4B5FF" />
                <stop offset="15%" stopColor="#A78BFF" />
                <stop offset="50%" stopColor="#7C5CFF" />
                <stop offset="80%" stopColor="#5A3AD4" />
                <stop offset="100%" stopColor="#7050E8" />
              </linearGradient>
              {/* Glass shine — bright horizontal streak at top of bar */}
              <linearGradient id="glassShine" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(255,255,255,0.5)" />
                <stop offset="8%" stopColor="rgba(255,255,255,0.2)" />
                <stop offset="20%" stopColor="rgba(255,255,255,0)" />
                <stop offset="100%" stopColor="rgba(0,0,0,0.1)" />
              </linearGradient>
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
              tick={{ fontSize: 13, fill: "#6B7280" }}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 12, fill: "#9CA3AF" }}
              tickFormatter={fmt}
              domain={[0, "auto"]}
              allowDecimals={unit !== "#"}
            />
            <Bar dataKey="value" maxBarSize={52} radius={[10, 10, 4, 4]}>
              {data.map((entry, index) => (
                <Cell
                  key={index}
                  fill={entry.isActive ? "url(#activeGrad)" : "url(#hatch)"}
                  fillOpacity={entry.isActive ? 1 : 0.9}
                  stroke={entry.isActive ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.04)"}
                  strokeWidth={entry.isActive ? 1.5 : 0.5}
                  style={entry.isActive ? { filter: "drop-shadow(0 2px 6px rgba(124,92,255,0.4))" } : undefined}
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
