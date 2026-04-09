"use client";

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
    const label = formatValue(Number(props.value ?? 0));
    return (
      <g>
        <rect x={cx - 36} y={cy - 12} width="72" height="24" rx="12" fill="#1A1A1F" />
        <text x={cx} y={cy + 4} textAnchor="middle" fill="#FFF" fontSize="12" fontWeight="600">
          {label}
        </text>
      </g>
    );
  }

  return (
    <div>
      {/* Period label */}
      <span className="inline-block rounded-md bg-[var(--surface-light,#F5F5F7)] px-3 py-1.5 text-[13px] font-medium text-[var(--foreground)]">
        {t("أسبوعي", "Weekly")}
      </span>

      {/* Chart */}
      <div className="mt-4">
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={data} barCategoryGap="12%">
            <defs>
              <pattern
                id="stripedPattern"
                patternUnits="userSpaceOnUse"
                width="5"
                height="5"
                patternTransform="rotate(45)"
              >
                <rect width="5" height="5" fill="var(--chart-stripe, #E5E5E0)" fillOpacity="0.6" />
                <line x1="0" y1="0" x2="0" y2="5" stroke="#D8D7D2" strokeWidth="1" />
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
              allowDecimals={unit !== "#"}
            />
            <Bar dataKey="value" maxBarSize={56} radius={[12, 12, 0, 0]}>
              {data.map((entry, index) => (
                <Cell
                  key={index}
                  fill={entry.isActive ? "var(--accent-purple, #7C5CFF)" : "url(#stripedPattern)"}
                  fillOpacity={entry.isActive ? 1 : 0.7}
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
