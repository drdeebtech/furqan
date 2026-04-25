"use client";

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
}

export function DataTable({ title, columns, rows, emptyMessage }: DataTableProps) {
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
                  {columns.map((col) => (
                    <td key={col.key} className="py-4 text-[13px] tabular-nums">
                      {renderCell(col, row[col.key], t)}
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

function renderCell(col: DataTableColumn, value: unknown, t: (ar: string, en: string) => string) {
  const str = String(value ?? "—");

  switch (col.type) {
    case "date":
      return <span className="text-muted">{str}</span>;

    case "progress": {
      const pct = typeof value === "number" ? value : parseInt(str) || 0;
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
      const name = String(value ?? "—");
      const initials = name.slice(0, 2);
      // Intentional decorative avatar colors — not part of the theme system
      const avatarColors = ["bg-[#C7B9F0]", "bg-[#A5C7F0]", "bg-[#F5B8A0]", "bg-[#9FD6C8]", "bg-[#F0B8C4]", "bg-[#A8D8B5]"];
      let hash = 0;
      for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
      const avatarBg = avatarColors[Math.abs(hash) % avatarColors.length];
      return (
        <div className="flex items-center gap-2">
          <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-[#1A1A1F] ring-2 ring-white ${avatarBg}`}>
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
