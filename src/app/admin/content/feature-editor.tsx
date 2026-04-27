"use client";

import { useActionState, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { upsertFeature, deleteFeature } from "./actions";
import { ActionFeedback } from "@/components/shared/action-feedback";
import { SITE_ICON_NAMES } from "@/lib/site-content/icon-map";
import type { LoudResult } from "@/lib/actions/loud";
import type { SiteFeature, SubjectMeta, PackagePreviewMeta } from "@/lib/site-content/types";

const input = "w-full rounded-xl glass-input px-3 py-2 text-sm focus:border-gold focus:outline-none";

export function FeatureEditor({ slotKey, slotLabel, features }: { slotKey: string; slotLabel: string; features: SiteFeature[] }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="mb-8 rounded-xl border border-[var(--surface-border)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{slotLabel} <span className="text-xs font-normal text-muted">({slotKey})</span></h3>
        <span className="text-xs text-muted">{features.length} {features.length === 1 ? "عنصر" : "عناصر"}</span>
      </div>
      <div className="space-y-2">
        {features.map((f) => <FeatureRow key={f.id} feature={f} slotKey={slotKey} />)}
        {!adding ? (
          <button
            onClick={() => setAdding(true)}
            className="glass-pill flex min-h-[40px] items-center gap-2 border border-[var(--surface-border)] px-3 py-1.5 text-xs hover:bg-foreground/5"
          >
            <Plus size={12} aria-hidden="true" /> إضافة / Add
          </button>
        ) : (
          <FeatureRow feature={null} slotKey={slotKey} onDone={() => setAdding(false)} />
        )}
      </div>
    </div>
  );
}

function FeatureRow({ feature, slotKey, onDone }: { feature: SiteFeature | null; slotKey: string; onDone?: () => void }) {
  const [state, formAction, pending] = useActionState<LoudResult | null, FormData>(upsertFeature, null);
  const [deleting, setDeleting] = useState(false);

  const meta = (feature?.meta ?? {}) as SubjectMeta & PackagePreviewMeta;
  const showLevel = slotKey === "home_subjects";
  const showFreq = slotKey === "home_package_preview";
  const showFeatured = slotKey === "home_package_preview";
  const showDescription = slotKey !== "home_trust_strip" && slotKey !== "home_package_preview";

  async function handleDelete() {
    if (!feature) return;
    if (!confirm("حذف هذا العنصر؟ / Delete this item?")) return;
    setDeleting(true);
    await deleteFeature(feature.id);
    setDeleting(false);
    location.reload();
  }

  return (
    <form action={formAction} className="rounded-lg border border-[var(--surface-border)] bg-foreground/5 p-3 space-y-2">
      <ActionFeedback state={state} />
      {feature && <input type="hidden" name="id" value={feature.id} />}
      <input type="hidden" name="slot" value={slotKey} />

      <div className="grid gap-2 md:grid-cols-3">
        <select name="icon_name" defaultValue={feature?.icon_name ?? "Star"} className={input}>
          {SITE_ICON_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <input className={input} name="title_ar" defaultValue={feature?.title_ar ?? ""} placeholder="العنوان (عربي)" required />
        <input className={input} name="title_en" defaultValue={feature?.title_en ?? ""} placeholder="Title (English)" dir="ltr" required />
      </div>

      {showDescription && (
        <div className="grid gap-2 md:grid-cols-2">
          <textarea className={input} name="description_ar" defaultValue={feature?.description_ar ?? ""} placeholder="الوصف (عربي)" rows={2} />
          <textarea className={input} name="description_en" defaultValue={feature?.description_en ?? ""} placeholder="Description (English)" dir="ltr" rows={2} />
        </div>
      )}

      {showLevel && (
        <div className="grid gap-2 md:grid-cols-2">
          <input className={input} name="meta_level_ar" defaultValue={meta.level_ar ?? ""} placeholder="المستوى (عربي) — مثال: للمبتدئين" />
          <input className={input} name="meta_level_en" defaultValue={meta.level_en ?? ""} placeholder="Level (English) — e.g. Beginner" dir="ltr" />
        </div>
      )}
      {showFreq && (
        <div className="grid gap-2 md:grid-cols-2">
          <input className={input} name="meta_freq_ar" defaultValue={meta.freq_ar ?? ""} placeholder="التكرار (عربي)" />
          <input className={input} name="meta_freq_en" defaultValue={meta.freq_en ?? ""} placeholder="Frequency (English)" dir="ltr" />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-2">
          <span className="text-muted">ترتيب</span>
          <input type="number" name="sort_order" defaultValue={feature?.sort_order ?? 100} className="w-20 rounded glass-input px-2 py-1 text-center" />
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="is_active" defaultChecked={feature?.is_active ?? true} className="accent-gold" />
          نشط
        </label>
        {showFeatured && (
          <label className="flex items-center gap-2">
            <input type="checkbox" name="meta_featured" defaultChecked={Boolean(meta.featured)} className="accent-gold" />
            مميّز
          </label>
        )}
        <div className="ms-auto flex gap-2">
          {feature && (
            <button type="button" onClick={handleDelete} disabled={deleting} className="glass-pill flex min-h-[36px] items-center gap-1 border border-red-500/30 px-3 py-1 text-red-400 hover:bg-red-500/10 disabled:opacity-50">
              <Trash2 size={12} aria-hidden="true" /> حذف
            </button>
          )}
          {onDone && <button type="button" onClick={onDone} className="glass-pill min-h-[36px] px-3 py-1 text-muted">إلغاء</button>}
          <button type="submit" disabled={pending} className="glass-gold glass-pill min-h-[36px] px-4 py-1 font-medium hover:bg-gold-hover disabled:opacity-50">
            {pending ? "..." : feature ? "حفظ" : "إضافة"}
          </button>
        </div>
      </div>
    </form>
  );
}
