"use client";

import type { ReactNode } from "react";
import Image from "next/image";
import { Eye } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { WidgetCard } from "./widget-card";

interface DataTableColumn {
  key: string;
  label: string;
  type?: "text" | "date" | "progress" | "assignee" | "actions";
  className?: string;
}

interface DataTableRow {
  id: string;
  [key: string]: unknown;
}

interface DataTableProps {
  title: string;
  columns: DataTableColumn[];
  rows: DataTableRow[];
  emptyMessage: string;
  /** When true, prepends a row-checkbox column (purely decorative — used by
   *  the student-dashboard "Continue Watching" table to match the reference). */
  selectable?: boolean;
  /** When true, swaps the depth-effect progress bars for flat 6px blue bars
   *  on a grey track. Used in the student-dashboard reference skin. */
  simpleProgress?: boolean;
  /** Optional custom renderer for the `actions` column. When provided,
   *  overrides the default eye-icon button. The dashboard uses this to
   *  inject a per-row `⋮` menu (Resume / Mark complete / Hide). */
  renderRowActions?: (row: DataTableRow) => ReactNode;
}

export function DataTable({ title, columns, rows, emptyMessage, selectable = false, simpleProgress = false, renderRowActions }: DataTableProps) {
  const { t } = useLang();
  return (
    <WidgetCard title={title} subtitle={rows.length > 0 ? `${rows.length}` : undefined}>
      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10">
          <Eye size={28} className="mb-2 text-[var(--muted-light,#9CA3AF)]" />
          <p className="text-sm text-muted">{emptyMessage}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr className="border-b border-[var(--surface-border)]">
                {selectable && (
                  <th scope="col" className="pb-3 ps-1 pe-3 w-6">
                    <span className="sr-only">{t("تحديد", "Select")}</span>
                  </th>
                )}
                {columns.map((col) => (
                  <th
                    key={col.key}
                    scope="col"
                    className={`pb-3 text-start text-xs font-medium uppercase tracking-wide text-[var(--muted-light,#9CA3AF)] ${col.className ?? ""}`}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-[var(--surface-divider,#F0F0F2)] transition-colors hover:bg-[var(--surface-hover,rgba(0,0,0,0.02))]">
                  {selectable && (
                    <td className="py-4 ps-1 pe-3">
                      <input
                        type="checkbox"
                        aria-label={t("تحديد", "Select row")}
                        className="h-4 w-4 cursor-pointer rounded-[2px] border-[1.5px] border-[#D1D5DB] accent-[var(--data-progress,#3B82F6)]"
                      />
                    </td>
                  )}
                  {columns.map((col) => (
                    <td key={col.key} className="py-4 text-[13px] tabular-nums">
                      {col.type === "actions" && renderRowActions
                        ? renderRowActions(row)
                        : renderCell(col, row[col.key], t, simpleProgress)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </WidgetCard>
  );
}

function renderCell(col: DataTableColumn, value: unknown, t: (ar: string, en: string) => string, simpleProgress = false) {
  const str = String(value ?? "—");

  switch (col.type) {
    case "date":
      return <span className="text-muted">{str}</span>;

    case "progress": {
      const pct = typeof value === "number" ? value : parseInt(str) || 0;
      if (simpleProgress) {
        return (
          <div className="flex items-center gap-2.5">
            <div className="relative h-1.5 w-[160px] overflow-hidden rounded-full bg-[var(--surface-divider)]">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.min(100, Math.max(0, pct))}%`,
                  background: "var(--data-progress)",
                }}
              />
            </div>
            <span className="text-sm font-medium text-foreground">{pct}%</span>
          </div>
        );
      }
      return (
        <div className="flex items-center gap-2.5">
          <div
            className="relative h-3.5 w-[160px] overflow-hidden rounded-full"
            style={{
              background: "linear-gradient(180deg, #E0DFD9 0%, #ECEAE5 50%, #E4E3DD 100%)",
              boxShadow: "inset 0 2px 4px rgba(0,0,0,0.1), inset 0 -1px 0 rgba(255,255,255,0.5), 0 1px 0 rgba(255,255,255,0.8)",
            }}
          >
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(100, Math.max(0, pct))}%`,
                background: "linear-gradient(180deg, #6EE89E 0%, #2DBF62 30%, #1A8A45 65%, #25A858 100%)",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.45), inset 0 -1px 0 rgba(0,0,0,0.1)",
              }}
            />
          </div>
          <span className="text-sm font-medium text-foreground">{pct}%</span>
        </div>
      );
    }

    case "assignee": {
      // Refined 3-tone palette — warm sand, soft moss, dusty stone. Drops the
      // generic SaaS pastel rainbow in favour of three premium tones that
      // sit comfortably alongside the gold accent without competing.
      const avatarColors = ["bg-[#E8D7A6]", "bg-[#C9DBC2]", "bg-[#E5CFC2]"];
      const colorFor = (s: string) => {
        let hash = 0;
        for (let i = 0; i < s.length; i++) hash = s.charCodeAt(i) + ((hash << 5) - hash);
        return avatarColors[Math.abs(hash) % avatarColors.length];
      };

      // Stacked variant: pass an array of {name, avatar_url?} for the
      // "+N" overlap chip pattern from the reference (student + teacher pair
      // for furqan's Continue Watching).
      if (Array.isArray(value)) {
        const items = value as { name: string; avatar_url?: string | null }[];
        const display = items.slice(0, 3);
        const overflow = items.length - display.length;
        return (
          <div className="flex items-center">
            <div className="flex">
              {display.map((it, i) => (
                <div
                  key={i}
                  className={`relative flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full text-[10px] font-bold text-[#2A2014] ring-2 ring-white ${colorFor(it.name)} ${i > 0 ? "-ms-2" : ""}`}
                  style={{ zIndex: display.length - i }}
                  title={it.name}
                >
                  {it.avatar_url ? (
                    <Image
                      src={it.avatar_url}
                      alt={it.name}
                      fill
                      sizes="28px"
                      className="object-cover"
                    />
                  ) : (
                    it.name.slice(0, 2)
                  )}
                </div>
              ))}
            </div>
            {overflow > 0 && (
              <span className="ms-1 rounded-full bg-[var(--surface-light)] px-1.5 py-0.5 text-[10px] font-medium text-foreground">
                +{overflow}
              </span>
            )}
          </div>
        );
      }

      const name = String(value ?? "—");
      const initials = name.slice(0, 2);
      const avatarBg = colorFor(name);
      return (
        <div className="flex items-center gap-2">
          <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-[#2A2014] ring-2 ring-white ${avatarBg}`}>
            {initials}
          </div>
          <span className="truncate text-[13px] text-foreground">{name}</span>
        </div>
      );
    }

    case "actions":
      return (
        <button
          type="button"
          aria-label={t("عرض", "View")}
          className="inline-flex items-center justify-center rounded p-1 text-[var(--muted-light,#9CA3AF)] hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
        >
          <Eye size={16} />
        </button>
      );

    default:
      return (
        <span className={col.key === "id" ? "font-medium" : "text-foreground"}>
          {str}
        </span>
      );
  }
}
