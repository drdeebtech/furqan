"use client";

import { useActionState } from "react";
import { Save, CheckCircle } from "lucide-react";
import { savePackage } from "./actions";
import { useLang } from "@/lib/i18n/context";
import type { Package } from "@/types/database";

const PACKAGE_TYPES = [
  { value: "single_session", label: "جلسة واحدة" },
  { value: "pack_4", label: "٤ جلسات" },
  { value: "pack_8", label: "٨ جلسات" },
  { value: "pack_12", label: "١٢ جلسة" },
  { value: "full_course", label: "دورة كاملة" },
];

type State = { success?: boolean; error?: string } | null;

export function PackageForm({ pkg }: { pkg?: Package }) {
  const { t } = useLang();
  const [state, formAction, pending] = useActionState<State, FormData>(
    async (_prev, fd) => savePackage(_prev ?? {}, fd),
    null,
  );

  if (state?.success) {
    return (
      <div className="glass-card p-8 text-center">
        <CheckCircle size={40} className="mx-auto mb-3 text-success" />
        <p className="text-lg font-semibold">{t("تم حفظ الباقة بنجاح", "Package saved successfully")}</p>
        <a href="/admin/packages" className="mt-4 inline-block text-sm text-gold hover:text-gold-hover">
          {t("العودة للباقات ←", "Back to packages →")}
        </a>
      </div>
    );
  }

  return (
    <form action={formAction} className="glass-card space-y-5 p-6">
      {pkg && <input type="hidden" name="id" value={pkg.id} />}

      {state?.error && (
        <div className="rounded-xl border border-error/30 bg-error/10 p-3 text-sm text-error">{state.error}</div>
      )}

      {/* Package type */}
      <div>
        <label className="mb-1 block text-sm font-medium">{t("نوع الباقة", "Package Type")} *</label>
        <select name="package_type" defaultValue={pkg?.package_type ?? "pack_4"} className="glass-input w-full px-4 py-2.5">
          {PACKAGE_TYPES.map(pt => <option key={pt.value} value={pt.value}>{pt.label}</option>)}
        </select>
      </div>

      {/* Names */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium">Name (EN) *</label>
          <input name="name" defaultValue={pkg?.name ?? ""} required className="glass-input w-full px-4 py-2.5" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">{t("الاسم بالعربي", "Name (AR)")}</label>
          <input name="name_ar" defaultValue={pkg?.name_ar ?? ""} className="glass-input w-full px-4 py-2.5" />
        </div>
      </div>

      {/* Descriptions */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium">Description (EN)</label>
          <textarea name="description" defaultValue={pkg?.description ?? ""} rows={2} className="glass-input w-full resize-none px-4 py-2.5" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">{t("الوصف بالعربي", "Description (AR)")}</label>
          <textarea name="description_ar" defaultValue={pkg?.description_ar ?? ""} rows={2} className="glass-input w-full resize-none px-4 py-2.5" />
        </div>
      </div>

      {/* Session count + Duration */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium">{t("عدد الجلسات", "Session Count")} *</label>
          <input name="session_count" type="number" min={1} defaultValue={pkg?.session_count ?? 1} required className="glass-input w-full px-4 py-2.5" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">{t("مدة الجلسة (دقيقة)", "Duration (min)")} *</label>
          <select name="duration_min" defaultValue={pkg?.duration_min ?? 30} className="glass-input w-full px-4 py-2.5">
            <option value={30}>30 {t("دقيقة", "min")}</option>
            <option value={45}>45 {t("دقيقة", "min")}</option>
            <option value={60}>60 {t("دقيقة", "min")}</option>
          </select>
        </div>
      </div>

      {/* Prices */}
      <div className="grid gap-4 sm:grid-cols-4">
        <div>
          <label className="mb-1 block text-sm font-medium">USD ($) *</label>
          <input name="price_usd" type="number" step="0.01" min="0.01" defaultValue={pkg?.price_usd ?? ""} required className="glass-input w-full px-4 py-2.5" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">GBP (£)</label>
          <input name="price_gbp" type="number" step="0.01" min="0" defaultValue={pkg?.price_gbp ?? ""} className="glass-input w-full px-4 py-2.5" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">SAR (ر.س)</label>
          <input name="price_sar" type="number" step="0.01" min="0" defaultValue={pkg?.price_sar ?? ""} className="glass-input w-full px-4 py-2.5" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">AUD (A$)</label>
          <input name="price_aud" type="number" step="0.01" min="0" defaultValue={pkg?.price_aud ?? ""} className="glass-input w-full px-4 py-2.5" />
        </div>
      </div>

      {/* Features */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium">Features (EN) <span className="text-xs text-muted">one per line</span></label>
          <textarea name="features" defaultValue={pkg?.features?.join("\n") ?? ""} rows={4} className="glass-input w-full resize-none px-4 py-2.5" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">{t("المميزات بالعربي", "Features (AR)")} <span className="text-xs text-muted">سطر لكل ميزة</span></label>
          <textarea name="features_ar" defaultValue={pkg?.features_ar?.join("\n") ?? ""} rows={4} className="glass-input w-full resize-none px-4 py-2.5" />
        </div>
      </div>

      {/* Flags + order */}
      <div className="flex flex-wrap items-center gap-6">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="is_active" defaultChecked={pkg?.is_active ?? true} className="rounded" />
          {t("نشطة", "Active")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="is_featured" defaultChecked={pkg?.is_featured ?? false} className="rounded" />
          {t("مميزة", "Featured")}
        </label>
        <div className="flex items-center gap-2">
          <label className="text-sm">{t("الترتيب", "Order")}</label>
          <input name="display_order" type="number" min={0} defaultValue={pkg?.display_order ?? 0} className="glass-input w-20 px-3 py-1.5 text-sm" />
        </div>
      </div>

      <button type="submit" disabled={pending} className="glass-gold glass-pill flex items-center gap-2 px-6 py-2.5 font-semibold transition-colors hover:bg-primary-hover disabled:opacity-50 focus-ring">
        {pending ? (
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
        ) : (
          <Save size={18} />
        )}
        {t("حفظ الباقة", "Save Package")}
      </button>
    </form>
  );
}
