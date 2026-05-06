import type { ReactNode } from "react";

interface StatTileProps {
  /** Small leading icon — typically a lucide-react `<Icon size={14} />`. */
  icon: ReactNode;
  /** Tile label / metric name. Required. */
  label: string;
  /** The number / string. Rendered in `text-2xl font-bold` by default. */
  value: ReactNode;
  /**
   * Color of the value. Default 'gold' matches the most-common inline
   * pattern across dashboards. Use 'foreground' for muted Stage 1+ stat
   * cards (per the .impeccable.md decorative-gold rule, post-B1 cleanup
   * the dashboard tile defaults could shift to 'foreground' too — keep
   * 'gold' as the default for now since it matches what's already on
   * production).
   */
  valueColor?: "gold" | "foreground" | "success" | "warning" | "error";
  /** Optional subtitle line below the value (e.g. "vs last month"). */
  subtitle?: string;
  /** Escape hatch for outer card spacing / sizing overrides. */
  className?: string;
}

const VALUE_TONE: Record<NonNullable<StatTileProps["valueColor"]>, string> = {
  gold: "text-gold",
  foreground: "text-foreground",
  success: "text-success",
  warning: "text-warning",
  error: "text-error",
};

/**
 * Non-clickable dashboard stat tile. Distinct from the rich
 * `<StatCard>` primitive (which is a `<Link>` with action footer +
 * progress bar + statusBadge) — this one's the simpler "icon + label
 * + bold number" tile that appears in metric strips on
 * /admin/sessions, /admin/users, /admin/control-tower, etc.
 *
 * Usage:
 *   <StatTile
 *     icon={<BarChart3 size={14} />}
 *     label={t("إجمالي الجلسات", "Total Sessions")}
 *     value={totalSessions}
 *   />
 *
 * Replaces the inline `<div className="glass-card p-4"><div>icon +
 * label</div><p>value</p></div>` pattern that was estimated at ~110
 * sites in the B3 audit.
 */
export function StatTile({
  icon,
  label,
  value,
  valueColor = "gold",
  subtitle,
  className,
}: StatTileProps) {
  return (
    <div className={`glass-card p-4 ${className ?? ""}`}>
      <div className="flex items-center gap-2 text-sm text-muted">
        {icon}
        {label}
      </div>
      <p className={`mt-1 text-2xl font-bold ${VALUE_TONE[valueColor]}`}>{value}</p>
      {subtitle ? <p className="mt-0.5 text-xs text-muted">{subtitle}</p> : null}
    </div>
  );
}
