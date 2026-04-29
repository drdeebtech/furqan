"use client";

import { ClipboardList, Info } from "lucide-react";
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
  /** Optional tooltip text shown on the info icon in the header */
  infoTooltip?: string;
  /** When true, swaps the depth-gradient segments for flat single-color
   *  fills with a pill-shaped track. Used by the student dashboard skin. */
  flat?: boolean;
}

function glassGradient(color: string) {
  // Parse hex to create lighter/darker variants for 3D glass effect
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  const light = `rgb(${Math.min(255, r + 60)}, ${Math.min(255, g + 60)}, ${Math.min(255, b + 60)})`;
  const dark = `rgb(${Math.max(0, r - 40)}, ${Math.max(0, g - 40)}, ${Math.max(0, b - 40)})`;
  const mid = `rgb(${Math.max(0, r - 15)}, ${Math.max(0, g - 15)}, ${Math.max(0, b - 15)})`;
  return `linear-gradient(180deg, ${light} 0%, ${color} 35%, ${dark} 70%, ${mid} 100%)`;
}

export function BreakdownBar({ title, segments, total, emptyMessage, infoTooltip, flat = false }: BreakdownBarProps) {
  const sum = segments.reduce((acc, s) => acc + s.value, 0);
  const isEmpty = segments.length === 0 || sum === 0;

  const headerAction = infoTooltip ? (
    <button
      type="button"
      aria-label={infoTooltip}
      title={infoTooltip}
      className="text-[var(--muted-light,#9CA3AF)] transition-colors hover:text-foreground"
    >
      <Info size={16} aria-hidden="true" />
    </button>
  ) : undefined;

  return (
    <WidgetCard title={title} headerAction={headerAction}>
      {isEmpty ? (
        <div className="flex flex-col items-center justify-center py-6">
          <ClipboardList size={32} className="mb-2 text-[var(--muted-light,#9CA3AF)]" />
          <p className="text-sm text-muted">
            {emptyMessage ?? "No data"}
          </p>
        </div>
      ) : (
        <>
          {total != null && (
            <p className="mb-3 text-xs text-muted">{total} items</p>
          )}
          <div
            className={flat ? "flex h-7 overflow-hidden rounded-full" : "flex h-8 overflow-hidden rounded-[10px]"}
            style={flat ? undefined : { boxShadow: "inset 0 2px 4px rgba(0,0,0,0.08), 0 1px 0 rgba(255,255,255,0.6)" }}
          >
            {segments.map((seg, i) => (
              <div
                key={i}
                className="h-full transition-all"
                style={
                  flat
                    ? { flexBasis: `${(seg.value / sum) * 100}%`, background: seg.color }
                    : {
                        flexBasis: `${(seg.value / sum) * 100}%`,
                        background: glassGradient(seg.color),
                        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -1px 0 rgba(0,0,0,0.1)",
                        borderInlineEnd: i < segments.length - 1 ? "1px solid rgba(0,0,0,0.1)" : "none",
                      }
                }
              />
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-4">
            {segments.map((seg, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <span
                  className="h-2 w-2 rounded-full"
                  style={
                    flat
                      ? { background: seg.color }
                      : { background: glassGradient(seg.color), boxShadow: "inset 0 1px 0 rgba(255,255,255,0.3)" }
                  }
                />
                <span className="text-[11px] text-muted">{seg.label}{!flat && <> <span className="font-medium text-foreground">{seg.value}</span></>}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </WidgetCard>
  );
}
