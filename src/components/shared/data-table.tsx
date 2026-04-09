"use client";

import { Search, MoreVertical, Eye } from "lucide-react";
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
  const headerAction = (
    <div className="flex items-center gap-1">
      <button
        type="button"
        className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-[var(--surface-light,#F5F5F7)]"
      >
        <Search size={16} className="text-[var(--muted-light,#9CA3AF)]" />
      </button>
      <button
        type="button"
        className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-[var(--surface-light,#F5F5F7)]"
      >
        <MoreVertical size={16} className="text-[var(--muted-light,#9CA3AF)]" />
      </button>
    </div>
  );

  return (
    <WidgetCard title={title} headerAction={headerAction}>
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
                <th className="w-10 pb-3 text-start">
                  <div className="flex h-4 w-4 items-center justify-center rounded border border-[var(--surface-border)]" />
                </th>
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
                  <td className="py-4">
                    <div className="flex h-4 w-4 items-center justify-center rounded border border-[var(--surface-border)]" />
                  </td>
                  {columns.map((col) => (
                    <td key={col.key} className="py-4 text-[13px]">
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
          <div className="h-1.5 w-[100px] overflow-hidden rounded-full bg-[var(--surface-divider,#F0F0F2)]">
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
      const initials = typeof value === "string" ? value.slice(0, 2) : "??";
      return (
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gold text-[10px] font-bold text-white ring-2 ring-white">
          {initials}
        </div>
      );
    }

    case "actions":
      return (
        <div className="flex items-center gap-2">
          <Eye size={16} className="text-[var(--muted-light,#9CA3AF)]" />
          <MoreVertical size={16} className="text-[var(--muted-light,#9CA3AF)]" />
        </div>
      );

    default:
      return (
        <span className={col.key === "id" ? "font-medium" : "text-[var(--foreground)]"}>
          {str}
        </span>
      );
  }
}
