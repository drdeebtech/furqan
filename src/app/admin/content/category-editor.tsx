"use client";

import { useActionState, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { upsertCategory, deleteCategory } from "./actions";
import { ActionFeedback } from "@/components/shared/action-feedback";
import type { LoudResult } from "@/lib/actions/loud";
import type { SiteBlogCategory } from "@/lib/site-content/types";

const input = "w-full rounded-xl glass-input px-3 py-2 text-sm focus:border-gold focus:outline-none";

export function CategoryEditor({ categories }: { categories: SiteBlogCategory[] }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="space-y-3">
      {categories.map((c) => <CategoryRow key={c.id} category={c} />)}
      {!adding ? (
        <button
          onClick={() => setAdding(true)}
          className="glass-pill flex min-h-[44px] items-center gap-2 border border-[var(--surface-border)] px-4 py-2 text-sm hover:bg-foreground/5"
        >
          <Plus size={14} aria-hidden="true" /> إضافة تصنيف / Add Category
        </button>
      ) : (
        <CategoryRow category={null} onDone={() => setAdding(false)} />
      )}
    </div>
  );
}

function CategoryRow({ category, onDone }: { category: SiteBlogCategory | null; onDone?: () => void }) {
  const [state, formAction, pending] = useActionState<LoudResult | null, FormData>(upsertCategory, null);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!category) return;
    if (!confirm("حذف هذا التصنيف؟ / Delete this category?")) return;
    setDeleting(true);
    await deleteCategory(category.id);
    setDeleting(false);
    location.reload();
  }

  return (
    <form action={formAction} className="glass-card flex flex-wrap items-end gap-2 p-3">
      <ActionFeedback state={state} />
      {category && <input type="hidden" name="id" value={category.id} />}

      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted">key</span>
        <input className={`${input} w-32`} name="key" defaultValue={category?.key ?? ""} placeholder="key" dir="ltr" required />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted">عربي</span>
        <input className={`${input} w-40`} name="label_ar" defaultValue={category?.label_ar ?? ""} required />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted">English</span>
        <input className={`${input} w-40`} name="label_en" defaultValue={category?.label_en ?? ""} dir="ltr" required />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted">ترتيب</span>
        <input type="number" name="sort_order" defaultValue={category?.sort_order ?? 100} className="w-20 rounded glass-input px-2 py-1 text-center text-sm" />
      </label>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" name="is_active" defaultChecked={category?.is_active ?? true} className="accent-gold" />
        نشط
      </label>
      <div className="ms-auto flex gap-2">
        {category && (
          <button type="button" onClick={handleDelete} disabled={deleting} className="glass-pill flex min-h-[36px] items-center gap-1 border border-red-500/30 px-3 py-1 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-50">
            <Trash2 size={12} aria-hidden="true" /> حذف
          </button>
        )}
        {onDone && <button type="button" onClick={onDone} className="glass-pill min-h-[36px] px-3 py-1 text-xs text-muted">إلغاء</button>}
        <button type="submit" disabled={pending} className="glass-gold glass-pill min-h-[36px] px-4 py-1 text-xs font-medium hover:bg-gold-hover disabled:opacity-50">
          {pending ? "..." : category ? "حفظ" : "إضافة"}
        </button>
      </div>
    </form>
  );
}
