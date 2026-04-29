"use client";

import Link from "next/link";
import { ArrowRight, ArrowLeft } from "lucide-react";
import { useLang } from "@/lib/i18n/context";

interface StatusBadge {
  text: string;
  type: "active" | "info" | "warning";
}

interface StatCardProps {
  icon: React.ElementType;
  label: string;
  value: string | number;
  href: string;
  subtitle?: string;
  actionLabel?: string;
  statusBadge?: StatusBadge;
  /** When set (0..100), renders a thin progress bar between the value and
   *  the action footer. Used by reference-style KPIs that show completion. */
  progressPct?: number;
}

export function StatCard({ icon: Icon, label, value, href, subtitle, actionLabel, statusBadge, progressPct }: StatCardProps) {
  const { dir } = useLang();
  const Arrow = dir === "rtl" ? ArrowLeft : ArrowRight;

  return (
    <Link
      href={href}
      className="glass-card hover-lift flex min-h-[172px] flex-col p-5 sm:p-6"
    >
      <div>
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[var(--surface-light,#F5F5F7)]">
            <Icon size={18} className="text-muted" />
          </div>
          <span className="text-sm text-muted">{label}</span>
          {statusBadge && (() => {
            const color =
              statusBadge.type === "warning"
                ? "var(--warning,#E0A830)"
                : statusBadge.type === "info"
                  ? "var(--muted)"
                  : "var(--accent-green,#22C55E)";
            return (
              <div className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium">
                {(statusBadge.type === "active" || statusBadge.type === "warning") && (
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
                )}
                <span style={{ color }}>{statusBadge.text}</span>
              </div>
            );
          })()}
        </div>
        <p className="mt-3 text-[clamp(2rem,4vw,3rem)] font-bold tracking-tight leading-none tabular-nums text-foreground">{value}</p>
        {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
        {progressPct != null && (
          <div className="mt-3 h-1.5 w-full rounded-full bg-[var(--surface-divider,#E5E7EB)]">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${Math.max(0, Math.min(100, progressPct))}%`, background: "var(--data-progress,#3B82F6)" }}
            />
          </div>
        )}
      </div>

      <div className="mt-auto flex items-center justify-between rounded-xl border border-[var(--surface-border)] px-3 py-2 transition-colors hover:bg-[var(--surface-hover,rgba(0,0,0,0.03))]">
        <span className="text-xs font-medium text-muted">{actionLabel}</span>
        <Arrow size={14} className="text-muted" />
      </div>
    </Link>
  );
}
