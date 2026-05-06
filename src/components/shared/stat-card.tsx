"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, ArrowLeft } from "lucide-react";
import { useLang } from "@/lib/i18n/context";

interface StatusBadge {
  text: string;
  type: "active" | "info" | "warning";
  /**
   * Optional inline-SVG icon (typically a lucide-react `<Icon size={11} />`).
   * When provided, replaces the colour-only dot — surfaces three signals
   * (icon + colour + label) so the badge is colour-blind safe. Backward-
   * compat: omitting `icon` preserves the legacy coloured-dot rendering.
   */
  icon?: ReactNode;
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
          <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[var(--gold-dim,rgba(200,166,82,0.12))]">
            <Icon size={18} className="text-gold" aria-hidden="true" />
          </div>
          <span className="min-w-0 flex-1 text-sm text-muted">{label}</span>
          {statusBadge && (() => {
            const color =
              statusBadge.type === "warning"
                ? "var(--warning,#E0A830)"
                : statusBadge.type === "info"
                  ? "var(--muted)"
                  : "var(--accent-green,#22C55E)";
            return (
              <div
                className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium"
                style={{ color }}
              >
                {statusBadge.icon ? (
                  <span aria-hidden="true" className="inline-flex shrink-0">
                    {statusBadge.icon}
                  </span>
                ) : (statusBadge.type === "active" || statusBadge.type === "warning") ? (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
                ) : null}
                <span>{statusBadge.text}</span>
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

      <div className="mt-auto flex items-center justify-between border-t border-[var(--surface-divider,#F0F0F2)] pt-3 transition-colors group-hover:text-foreground">
        <span className="text-xs font-medium text-muted">{actionLabel}</span>
        <Arrow size={14} className="text-muted" />
      </div>
    </Link>
  );
}
