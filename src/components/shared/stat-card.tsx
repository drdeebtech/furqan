"use client";

import Link from "next/link";
import { ArrowRight, ArrowLeft } from "lucide-react";
import { useLang } from "@/lib/i18n/context";

interface StatusBadge {
  text: string;
  type: "active" | "info";
}

interface StatCardProps {
  icon: React.ElementType;
  label: string;
  value: string | number;
  href: string;
  subtitle?: string;
  progress?: number;
  actionLabel?: string;
  statusBadge?: StatusBadge;
}

export function StatCard({ icon: Icon, label, value, href, subtitle, progress, actionLabel, statusBadge }: StatCardProps) {
  const { dir } = useLang();
  const Arrow = dir === "rtl" ? ArrowLeft : ArrowRight;

  return (
    <Link
      href={href}
      className="glass-card flex min-h-[180px] flex-col p-6 transition-colors"
    >
      <div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[var(--surface-light,#F5F5F7)]">
              <Icon size={18} className="text-[var(--muted)]" />
            </div>
            <span className="text-[13px] font-medium text-[var(--muted)]">{label}</span>
          </div>
          {statusBadge && (
            <div className="flex items-center gap-1">
              {statusBadge.type === "active" && (
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-green,#22C55E)]" />
              )}
              <span className="text-[12px] text-[var(--accent-green,#22C55E)]">{statusBadge.text}</span>
            </div>
          )}
        </div>
        <p className="mt-4 text-5xl font-bold tracking-tight text-[var(--foreground)]">{value}</p>
        {subtitle && <p className="mt-0.5 text-xs text-[var(--muted)]">{subtitle}</p>}
      </div>

      {progress !== undefined && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-[var(--muted)]">Progress</span>
            <span className="text-[var(--muted)]">{progress}%</span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-divider,#F0F0F2)]">
            <div
              className="h-full rounded-full bg-[var(--accent-purple,#7C5CFF)] transition-all"
              style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
            />
          </div>
        </div>
      )}

      <div className="mt-auto flex items-center justify-between rounded-xl border border-[var(--surface-border)] px-3 py-2 transition-colors hover:bg-[var(--surface-hover,rgba(0,0,0,0.03))]">
        <span className="text-xs font-medium text-[var(--muted)]">{actionLabel}</span>
        <Arrow size={14} className="text-[var(--muted)]" />
      </div>
    </Link>
  );
}
