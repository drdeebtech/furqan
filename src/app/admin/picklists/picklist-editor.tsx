"use client";

import { useActionState, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { upsertPicklistRow, deletePicklistRow } from "./actions";
import { ActionFeedback } from "@/components/shared/action-feedback";
import type { LoudResult } from "@/lib/actions/loud";
import type { TeacherLanguage } from "@/lib/site-content/types";

const input = "rounded-xl glass-input px-3 py-2 text-sm focus:border-gold focus:outline-none";

type PicklistTable = "teacher_languages" | "teacher_specialties" | "teacher_recitations";

export function PicklistEditor({ table, rows }: { table: PicklistTable; rows: TeacherLanguage[] }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="space-y-2">
      {rows.map((r) => <PicklistRow key={r.key} table={table} row={r} />)}
      {!adding ? (
        <button
          onClick={() => setAdding(true)}
          className="glass-pill flex min-h-[44px] items-center gap-2 border border-[var(--surface-border)] px-4 py-2 text-sm hover:bg-foreground/5"
        >
          <Plus size={14} aria-hidden="true" /> إضافة / Add
        </button>
      ) : (
        <PicklistRow table={table} row={null} onDone={() => setAdding(false)} />
      )}
    </div>
  );
}

function PicklistRow({
  table,
  row,
  onDone,
}: {
  table: PicklistTable;
  row: TeacherLanguage | null;
  onDone?: () => void;
}) {
  const [state, formAction, pending] = useActionState<LoudResult | null, FormData>(
    upsertPicklistRow,
    null,
  );
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!row) return;
    if (!confirm(`حذف "${row.key}"؟ / Delete "${row.key}"?`)) return;
    setDeleting(true);
    await deletePicklistRow(table, row.key);
    setDeleting(false);
    location.reload();
  }

  return (
    <form action={formAction} className="glass-card flex flex-wrap items-end gap-2 p-3">
      <ActionFeedback state={state} />
      <input type="hidden" name="table" value={table} />
      {row && <input type="hidden" name="old_key" value={row.key} />}

      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted">key</span>
        <input className={`${input} w-32`} name="key" defaultValue={row?.key ?? ""} dir="ltr" required />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted">عربي</span>
        <input className={`${input} w-48`} name="label_ar" defaultValue={row?.label_ar ?? ""} required />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted">English</span>
        <input className={`${input} w-48`} name="label_en" defaultValue={row?.label_en ?? ""} dir="ltr" required />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted">ترتيب</span>
        <input type="number" name="sort_order" defaultValue={row?.sort_order ?? 100} className={`${input} w-20 text-center`} />
      </label>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" name="is_active" defaultChecked={row?.is_active ?? true} className="accent-gold" />
        نشط
      </label>
      <div className="ms-auto flex gap-2">
        {row && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="glass-pill flex min-h-[36px] items-center gap-1 border border-error/30 px-3 py-1 text-xs text-red-400 hover:bg-error/10 disabled:opacity-50"
          >
            <Trash2 size={12} aria-hidden="true" /> حذف
          </button>
        )}
        {onDone && <button type="button" onClick={onDone} className="glass-pill min-h-[36px] px-3 py-1 text-xs text-muted">إلغاء</button>}
        <button
          type="submit"
          disabled={pending}
          className="glass-gold glass-pill min-h-[36px] px-4 py-1 text-xs font-medium hover:bg-gold-hover disabled:opacity-50"
        >
          {pending ? "..." : row ? "حفظ" : "إضافة"}
        </button>
      </div>
    </form>
  );
}
