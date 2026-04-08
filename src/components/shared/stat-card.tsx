"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useLang } from "@/lib/i18n/context";

interface StatCardProps {
  icon: React.ElementType;
  label: string;
  value: string | number;
  href: string;
  subtitle?: string;
  progress?: number;
}

export function StatCard({ icon: Icon, label, value, href, subtitle, progress }: StatCardProps) {
  const { dir } = useLang();
  const Arrow = dir === "rtl" ? ChevronLeft : ChevronRight;

  return (
    <Link
      href={href}
      className="glass-card flex min-h-[120px] flex-col justify-between p-4 transition-colors hover:border-gold/40 sm:p-5"
    >
      <div>
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gold/10">
            <Icon size={16} className="text-gold" />
          </div>
          <span className="text-xs text-muted">{label}</span>
        </div>
        <p className="mt-3 text-2xl font-bold sm:text-3xl">{value}</p>
        {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
      </div>
      {progress !== undefined && (
        <div className="mt-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted">{progress}%</span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gold transition-all"
              style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
            />
          </div>
        </div>
      )}
      <div className="mt-2 flex items-center justify-end">
        <Arrow size={16} className="text-muted" />
      </div>
    </Link>
  );
}
