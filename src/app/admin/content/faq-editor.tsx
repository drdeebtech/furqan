"use client";

import { useActionState, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { upsertFaq, deleteFaq } from "./actions";
import { ActionFeedback } from "@/components/shared/action-feedback";
import { useToast } from "@/components/shared/toast";
import type { LoudResult } from "@/lib/actions/loud";
import type { SiteFaq } from "@/lib/site-content/types";

const input = "w-full rounded-xl glass-input px-3 py-2 text-sm focus:border-gold focus:outline-none";

export function FaqEditor({ faqs }: { faqs: SiteFaq[] }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="space-y-3">
      {faqs.map((f) => <FaqRow key={f.id} faq={f} />)}
      {!adding ? (
        <button
          onClick={() => setAdding(true)}
          className="glass-pill flex min-h-[44px] items-center gap-2 border border-[var(--surface-border)] px-4 py-2 text-sm hover:bg-foreground/5"
        >
          <Plus size={14} aria-hidden="true" /> إضافة سؤال جديد / Add FAQ
        </button>
      ) : (
        <FaqRow faq={null} onDone={() => setAdding(false)} />
      )}
    </div>
  );
}

function FaqRow({ faq, onDone }: { faq: SiteFaq | null; onDone?: () => void }) {
  const [state, formAction, pending] = useActionState<LoudResult | null, FormData>(upsertFaq, null);
  const [deleting, setDeleting] = useState(false);
  const toast = useToast();

  async function handleDelete() {
    if (!faq) return;
    if (!confirm("حذف هذا السؤال؟ / Delete this FAQ?")) return;
    setDeleting(true);
    const res = await deleteFaq(faq.id);
    setDeleting(false);
    if (res && res.ok === false) {
      toast.error(res.error ?? "فشل الحذف / Delete failed");
      return;
    }
    location.reload();
  }

  return (
    <form action={formAction} className="glass-card space-y-2 p-4">
      <ActionFeedback state={state} />
      {faq && <input type="hidden" name="id" value={faq.id} />}

      <div className="grid gap-2 md:grid-cols-2">
        <input className={input} name="question_ar" defaultValue={faq?.question_ar ?? ""} placeholder="السؤال (عربي)" required />
        <input className={input} name="question_en" defaultValue={faq?.question_en ?? ""} placeholder="Question (English)" dir="ltr" required />
      </div>
      <textarea className={input} name="answer_ar" defaultValue={faq?.answer_ar ?? ""} placeholder="الإجابة (عربي)" rows={2} required />
      <textarea className={input} name="answer_en" defaultValue={faq?.answer_en ?? ""} placeholder="Answer (English)" dir="ltr" rows={2} required />

      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-2">
          <span className="text-muted">ترتيب / Order</span>
          <input type="number" name="sort_order" defaultValue={faq?.sort_order ?? 100} className="w-20 rounded glass-input px-2 py-1 text-center" />
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="is_active" defaultChecked={faq?.is_active ?? true} className="accent-gold" />
          نشط / Active
        </label>
        <div className="ms-auto flex gap-2">
          {faq && (
            <button type="button" onClick={handleDelete} disabled={deleting} className="glass-pill flex min-h-[36px] items-center gap-1 border border-error/30 px-3 py-1 text-xs text-red-400 hover:bg-error/10 disabled:opacity-50">
              <Trash2 size={12} aria-hidden="true" /> حذف
            </button>
          )}
          {onDone && <button type="button" onClick={onDone} className="glass-pill min-h-[36px] px-3 py-1 text-xs text-muted">إلغاء</button>}
          <button type="submit" disabled={pending} className="glass-gold glass-pill min-h-[36px] px-4 py-1 text-xs font-medium hover:bg-gold-hover disabled:opacity-50">
            {pending ? "..." : faq ? "حفظ" : "إضافة"}
          </button>
        </div>
      </div>
    </form>
  );
}
