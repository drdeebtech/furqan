"use client";

import { Eye } from "lucide-react";
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
  return (
    <WidgetCard title={title} subtitle={rows.length > 0 ? `${rows.length}` : undefined}>
      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10">
          <Eye size={28} className="mb-2 text-[var(--muted-light,#9CA3AF)]" />
          <p className="text-sm text-[var(--muted)]">{emptyMessage}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--surface-border)]">
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className={`pb-3 text-start text-[11px] font-medium uppercase tracking-wide text-[var(--muted-light,#9CA3AF)] ${col.className ?? ""}`}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-[var(--surface-divider,#F0F0F2)]">
                  {columns.map((col) => (
                    <td key={col.key} className="py-4 text-[13px] tabular-nums">
                      {renderCell(col, row[col.key])}
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

function renderCell(col: DataTableColumn, value: unknown) {
  const str = String(value ?? "—");

  switch (col.type) {
    case "date":
      return <span className="text-[var(--muted)]">{str}</span>;

    case "progress": {
      const pct = typeof value === "number" ? value : parseInt(str) || 0;
      return (
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-[140px] overflow-hidden rounded-full bg-[var(--surface-divider,#F0F0F2)]">
            <div
              className="h-full rounded-full bg-[var(--data-progress,#3B82F6)]"
              style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
            />
          </div>
          <span className="text-[var(--muted)]">{pct}%</span>
        </div>
      );
    }

    case "assignee": {
      const name = String(value ?? "—");
      const initials = name.slice(0, 2);
      const avatarColors = ["bg-[#C7B9F0]", "bg-[#A5C7F0]", "bg-[#F5B8A0]", "bg-[#9FD6C8]", "bg-[#F0B8C4]", "bg-[#A8D8B5]"];
      let hash = 0;
      for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
      const avatarBg = avatarColors[Math.abs(hash) % avatarColors.length];
      return (
        <div className="flex items-center gap-2">
          <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-[#1A1A1F] ring-2 ring-white ${avatarBg}`}>
            {initials}
          </div>
          <span className="truncate text-[13px] text-[var(--foreground)]">{name}</span>
        </div>
      );
    }

    case "actions":
      return (
        <Eye size={16} className="text-[var(--muted-light,#9CA3AF)]" />
      );

    default:
      return (
        <span className={col.key === "id" ? "font-medium" : "text-[var(--foreground)]"}>
          {str}
        </span>
      );
  }
}
