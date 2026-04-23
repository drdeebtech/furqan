"use client";

import dynamic from "next/dynamic";

/**
 * Dynamic wrapper around the Recharts-backed analytics-chart-impl.
 *
 * Recharts is ~70 kB gzipped. Before this split it lived in the shared
 * client chunk of every dashboard (student/teacher/admin/moderator).
 * Now it loads only when a chart actually renders.
 *
 * SSR disabled because Recharts relies on DOM measurements for its
 * ResponsiveContainer; rendering on the server just produces a blank
 * placeholder anyway.
 */
export const AnalyticsChart = dynamic(
  () => import("./analytics-chart-impl").then((m) => m.AnalyticsChart),
  {
    ssr: false,
    loading: () => (
      <div className="h-64 w-full animate-pulse rounded-xl bg-surface/40" />
    ),
  },
);
