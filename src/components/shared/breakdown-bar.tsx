"use client";

import { ClipboardList } from "lucide-react";
import { WidgetCard } from "./widget-card";

interface BreakdownSegment {
  label: string;
  value: number;
  color: string;
}

interface BreakdownBarProps {
  title: string;
  segments: BreakdownSegment[];
  total?: number;
  emptyMessage?: string;
}

export function BreakdownBar({ title, segments, total, emptyMessage }: BreakdownBarProps) {
  const sum = segments.reduce((acc, s) => acc + s.value, 0);
  const isEmpty = segments.length === 0 || sum === 0;

  return (
    <WidgetCard title={title}>
      {isEmpty ? (
        <div className="flex flex-col items-center justify-center py-6">
          <ClipboardList size={32} className="mb-2 text-[var(--muted-light,#9CA3AF)]" />
          <p className="text-sm text-[var(--muted)]">
            {emptyMessage ?? "No data"}
          </p>
        </div>
      ) : (
        <>
          {total != null && (
            <p className="mb-3 text-xs text-[var(--muted)]">{total} items</p>
          )}
          <div className="flex h-7 overflow-hidden rounded-[8px] bg-[var(--surface-divider,#F0F0F2)]">
            {segments.map((seg, i) => (
              <div
                key={i}
                className="h-full transition-all"
                style={{
                  flexBasis: `${(seg.value / sum) * 100}%`,
                  backgroundColor: seg.color,
                }}
              />
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-4">
            {segments.map((seg, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: seg.color }}
                />
                <span className="text-[11px] text-[var(--muted)]">{seg.label}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </WidgetCard>
  );
}
