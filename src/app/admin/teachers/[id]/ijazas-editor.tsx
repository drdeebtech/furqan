"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Check, X, Save, Pencil } from "lucide-react";
import {
  upsertIjaza,
  deleteIjaza,
  setIjazaVerified,
  type ActionResult,
} from "./actions";

const input =
  "w-full rounded-xl glass-input px-4 py-2.5 text-sm text-foreground focus:border-gold focus:outline-none";

const RIWAYAT = [
  { value: "hafs", label: "حفص عن عاصم" },
  { value: "warsh", label: "ورش عن نافع" },
  { value: "qalon", label: "قالون عن نافع" },
  { value: "al_duri", label: "الدوري" },
  { value: "shu_ba", label: "شعبة" },
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

interface IjazasEditorProps {
  teacherId: string;
  ijazas: Ijaza[];
}

export function IjazasEditor({ teacherId, ijazas }: IjazasEditorProps) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          الإجازات
          <span className="me-2 text-sm font-normal text-muted">Ijazas ({ijazas.length})</span>
        </h2>
        {!adding && !editingId && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="glass-gold glass-pill flex items-center gap-2 px-4 py-2 text-sm font-medium hover:bg-gold-hover"
          >
            <Plus size={14} />
            إضافة إجازة
          </button>
        )}
      </div>

      {adding && (
        <IjazaForm
          teacherId={teacherId}
          onDone={() => {
            setAdding(false);
            router.refresh();
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      <div className="space-y-3">
        {ijazas.length === 0 && !adding && (
          <p className="rounded-xl glass-card p-6 text-center text-sm text-muted">
            لا توجد إجازات — اضغط &quot;إضافة إجازة&quot; لإدخال أول سند.
          </p>
        )}

        {ijazas.map((ij) => (
          <div key={ij.id}>
            {editingId === ij.id ? (
              <IjazaForm
                teacherId={teacherId}
                initial={ij}
                onDone={() => {
                  setEditingId(null);
                  router.refresh();
                }}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <IjazaRow
                teacherId={teacherId}
                ijaza={ij}
                onEdit={() => setEditingId(ij.id)}
                onChanged={() => router.refresh()}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function IjazaRow({
  teacherId,
  ijaza,
  onEdit,
  onChanged,
}: {
  teacherId: string;
  ijaza: Ijaza;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const riwayaLabel = RIWAYAT.find((r) => r.value === ijaza.riwaya)?.label ?? ijaza.riwaya;

  const handleDelete = () => {
    if (!confirm("حذف هذه الإجازة؟")) return;
    startTransition(async () => {
      await deleteIjaza(teacherId, ijaza.id);
      onChanged();
    });
  };

  const handleToggleVerify = () => {
    startTransition(async () => {
      await setIjazaVerified(teacherId, ijaza.id, !ijaza.verified_at);
      onChanged();
    });
  };

  return (
    <div className="glass-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{riwayaLabel}</span>
            {ijaza.verified_at ? (
              <span className="glass-badge border-success/30 bg-success/10 text-xs text-success">
                ✓ موثقة
              </span>
            ) : (
              <span className="glass-badge border-warning/30 bg-warning/10 text-xs text-warning">
                بانتظار التوثيق
              </span>
            )}
          </div>
          <p className="mt-1 whitespace-pre-wrap text-xs text-muted">{ijaza.chain_text}</p>
          {(ijaza.granted_by || ijaza.granted_at) && (
            <p className="mt-1 text-xs text-muted">
              {ijaza.granted_by && <>عن: {ijaza.granted_by}</>}
              {ijaza.granted_by && ijaza.granted_at && " · "}
              {ijaza.granted_at && <>بتاريخ: {ijaza.granted_at}</>}
            </p>
          )}
          {ijaza.document_url && (
            <a
              href={ijaza.document_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-block text-xs text-gold hover:text-gold-light"
            >
              عرض المستند →
            </a>
          )}
        </div>

        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={handleToggleVerify}
            disabled={pending}
            className="glass-pill px-3 py-1.5 text-xs font-medium hover:bg-success/10 hover:text-success disabled:opacity-50"
            title={ijaza.verified_at ? "إلغاء التوثيق" : "توثيق"}
            aria-label={ijaza.verified_at ? "إلغاء التوثيق" : "توثيق"}
          >
            <Check size={12} />
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="glass-pill px-3 py-1.5 text-xs font-medium hover:bg-gold/10 hover:text-gold"
            title="تعديل"
            aria-label="تعديل"
          >
            <Pencil size={12} />
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={pending}
            className="glass-pill px-3 py-1.5 text-xs font-medium hover:bg-error/10 hover:text-error disabled:opacity-50"
            title="حذف"
            aria-label="حذف"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}

function IjazaForm({
  teacherId,
  initial,
  onDone,
  onCancel,
}: {
  teacherId: string;
  initial?: Ijaza;
  onDone: () => void;
  onCancel: () => void;
}) {
  const boundAction = upsertIjaza.bind(null, teacherId);
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(boundAction, {});

  if (state.success) {
    onDone();
  }

  return (
    <form action={formAction} className="glass-card p-4 space-y-3">
      {initial && <input type="hidden" name="id" value={initial.id} />}

      {state.error && (
        <div role="alert" className="rounded-xl border border-error/30 bg-error/10 p-2 text-xs text-error">
          {state.error}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium">الرواية *</label>
          <select name="riwaya" defaultValue={initial?.riwaya ?? "hafs"} className={input} required>
            {RIWAYAT.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">ممنوحة من</label>
          <input
            name="granted_by"
            defaultValue={initial?.granted_by ?? ""}
            placeholder="الشيخ..."
            className={input}
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium">سند الإجازة *</label>
        <textarea
          name="chain_text"
          rows={3}
          required
          defaultValue={initial?.chain_text ?? ""}
          placeholder="السند المتصل..."
          className={`${input} resize-none`}
        />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium">تاريخ المنح</label>
          <input
            name="granted_at"
            type="date"
            defaultValue={initial?.granted_at ?? ""}
            className={`${input} text-left`}
            dir="ltr"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">رابط المستند</label>
          <input
            name="document_url"
            type="url"
            defaultValue={initial?.document_url ?? ""}
            placeholder="https://..."
            className={`${input} text-left`}
            dir="ltr"
          />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="glass-pill px-4 py-2 text-xs font-medium text-muted hover:text-foreground"
        >
          <X size={12} className="inline" /> إلغاء
        </button>
        <button
          type="submit"
          disabled={pending}
          className="glass-gold glass-pill flex items-center gap-2 px-4 py-2 text-xs font-medium hover:bg-gold-hover disabled:opacity-50"
        >
          <Save size={12} />
          {initial ? "حفظ" : "إضافة"}
        </button>
      </div>
    </form>
  );
}
