"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Plus, Trash2, CheckCircle, Clock, ExternalLink, Save } from "lucide-react";
import { upsertMyIjaza, deleteMyIjaza } from "./ijaza-actions";
import { ActionFeedback } from "@/components/shared/action-feedback";
import { safeHref } from "@/lib/security/safe-url";
import type { LoudResult } from "@/lib/actions/loud";

const input = "w-full rounded-xl glass-input px-3 py-2 text-sm focus:border-gold focus:outline-none";

const RIWAYAT = [
  { value: "hafs", label: "حفص عن عاصم" },
  { value: "shu_ba", label: "شعبة عن عاصم" },
  { value: "warsh", label: "ورش عن نافع" },
  { value: "qalon", label: "قالون عن نافع" },
  { value: "al_duri_basri", label: "الدوري عن أبي عمرو" },
  { value: "al_susi", label: "السوسي عن أبي عمرو" },
  { value: "hisham", label: "هشام عن ابن عامر" },
  { value: "ibn_dhakwan", label: "ابن ذكوان عن ابن عامر" },
  { value: "al_bazzi", label: "البزي عن ابن كثير" },
  { value: "qunbul", label: "قنبل عن ابن كثير" },
  { value: "khalaf_hamzah", label: "خلف عن حمزة" },
  { value: "khallad", label: "خلاد عن حمزة" },
];

interface Ijaza {
  id: string;
  riwaya: string;
  chain_text: string;
  granted_by: string | null;
  granted_at: string | null;
  document_url: string | null;
  verified_by: string | null;
  verified_at: string | null;
}

export function MyIjazas({ ijazas }: { ijazas: Ijaza[] }) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-3">
      {ijazas.length === 0 && !adding && (
        <p className="text-sm text-muted">
          لم تضف أي إجازة بعد. اضغط أدناه لإضافة أول إجازة وستراجعها الإدارة.
        </p>
      )}

      {ijazas.map((ij) => (
        <IjazaRow key={ij.id} ijaza={ij} />
      ))}

      {!adding ? (
        <button
          onClick={() => setAdding(true)}
          className="glass-pill flex min-h-[44px] items-center gap-2 border border-[var(--surface-border)] px-4 py-2 text-sm hover:bg-foreground/5"
        >
          <Plus size={14} aria-hidden="true" /> إضافة إجازة
        </button>
      ) : (
        <IjazaRow ijaza={null} onDone={() => setAdding(false)} />
      )}
    </div>
  );
}

function IjazaRow({ ijaza, onDone }: { ijaza: Ijaza | null; onDone?: () => void }) {
  const [state, formAction, pending] = useActionState<LoudResult | null, FormData>(
    upsertMyIjaza,
    null,
  );
  const [deleting, setDeleting] = useState(false);

  const isVerified = !!ijaza?.verified_by;

  async function handleDelete() {
    if (!ijaza) return;
    if (!confirm("حذف هذه الإجازة؟")) return;
    setDeleting(true);
    const result = await deleteMyIjaza(ijaza.id);
    setDeleting(false);
    if (result.ok) location.reload();
    else alert(result.error);
  }

  if (isVerified && ijaza) {
    return (
      <div className="glass-card flex items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <CheckCircle size={14} className="text-success shrink-0" aria-hidden="true" />
            <span className="glass-badge inline-flex items-center gap-1 border-success/30 bg-success/10 px-2 py-0.5 text-[10px] text-success">
              موثقة
            </span>
            <span className="text-sm font-medium">{labelForRiwaya(ijaza.riwaya)}</span>
          </div>
          <p className="mt-2 text-xs text-muted whitespace-pre-line">{ijaza.chain_text}</p>
          {ijaza.document_url && (
            <Link href={safeHref(ijaza.document_url)} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-gold hover:text-gold-light">
              <ExternalLink size={12} aria-hidden="true" /> مستند الإجازة
            </Link>
          )}
        </div>
        <p className="text-[10px] text-muted shrink-0">للتعديل، تواصل مع الإدارة</p>
      </div>
    );
  }

  return (
    <form action={formAction} className="glass-card space-y-3 p-4">
      <ActionFeedback state={state} />
      {ijaza && <input type="hidden" name="id" value={ijaza.id} />}

      <div className="flex items-center gap-2">
        {ijaza ? (
          <span className="glass-badge inline-flex items-center gap-1 border-warning/30 bg-warning/10 px-2 py-0.5 text-[10px] text-warning">
            <Clock size={11} aria-hidden="true" /> بانتظار المراجعة
          </span>
        ) : (
          <span className="text-sm font-medium">إجازة جديدة</span>
        )}
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted">الرواية *</span>
          <select className={input} name="riwaya" defaultValue={ijaza?.riwaya ?? ""} required>
            <option value="">— اختر الرواية —</option>
            {RIWAYAT.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted">الشيخ المُجيز</span>
          <input className={input} name="granted_by" defaultValue={ijaza?.granted_by ?? ""} placeholder="اسم الشيخ" />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted">سند الإجازة *</span>
        <textarea className={input} name="chain_text" defaultValue={ijaza?.chain_text ?? ""} rows={4} placeholder="السلسلة الكاملة من الشيخ المُجيز إلى النبي ﷺ" required />
      </label>

      <div className="grid gap-2 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted">تاريخ الإجازة</span>
          <input type="date" className={input} name="granted_at" defaultValue={ijaza?.granted_at?.slice(0, 10) ?? ""} dir="ltr" />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted">رابط المستند (PDF / صورة)</span>
          <input type="url" className={input} name="document_url" defaultValue={ijaza?.document_url ?? ""} dir="ltr" placeholder="https://..." />
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        {ijaza && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="glass-pill flex min-h-[44px] items-center gap-1.5 border border-error/30 px-3 py-1.5 text-xs text-red-400 hover:bg-error/10 disabled:opacity-50"
          >
            <Trash2 size={12} aria-hidden="true" /> حذف
          </button>
        )}
        {onDone && (
          <button type="button" onClick={onDone} className="glass-pill min-h-[44px] px-3 py-1.5 text-xs text-muted">إلغاء</button>
        )}
        <button
          type="submit"
          disabled={pending}
          className="glass-gold glass-pill ms-auto flex min-h-[44px] items-center gap-1.5 px-4 py-1.5 text-xs font-medium hover:bg-gold-hover disabled:opacity-50"
        >
          {pending ? "..." : <><Save size={12} aria-hidden="true" /> {ijaza ? "حفظ" : "إرسال للمراجعة"}</>}
        </button>
      </div>
    </form>
  );
}

function labelForRiwaya(value: string): string {
  return RIWAYAT.find((r) => r.value === value)?.label ?? value;
}
