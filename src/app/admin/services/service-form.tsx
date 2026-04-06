"use client";

import { useActionState } from "react";
import { Save } from "lucide-react";
import { saveService } from "./actions";

interface ServiceData {
  id?: string;
  title: string;
  title_ar: string | null;
  description: string;
  description_ar: string | null;
  features: string[];
  features_ar: string[];
  icon: string | null;
  image_url: string | null;
  display_order: number;
  is_active: boolean;
}

const input = "w-full rounded-lg border border-input-border bg-input px-3 py-2 text-sm focus:border-gold focus:outline-none";

export function ServiceForm({ service }: { service?: ServiceData }) {
  const [, formAction, pending] = useActionState<{ success?: boolean }, FormData>(saveService, {});

  return (
    <form action={formAction} className="space-y-4">
      {service?.id && <input type="hidden" name="id" value={service.id} />}

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium">Title (English) *</label>
          <input name="title" required defaultValue={service?.title} className={input} placeholder="Quran Memorization (Hifz)" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">العنوان (عربي)</label>
          <input name="title_ar" defaultValue={service?.title_ar ?? ""} className={input} placeholder="حفظ القرآن الكريم" />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium">Description (English) *</label>
          <textarea name="description" required rows={3} defaultValue={service?.description} className={`${input} resize-none`} placeholder="Service description..." />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">الوصف (عربي)</label>
          <textarea name="description_ar" rows={3} defaultValue={service?.description_ar ?? ""} className={`${input} resize-none`} placeholder="وصف الخدمة..." />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium">Features (English, one per line)</label>
          <textarea name="features" rows={4} defaultValue={service?.features.join("\n") ?? ""} className={`${input} resize-none`} placeholder={"Feature 1\nFeature 2\nFeature 3"} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">المميزات (عربي، سطر لكل ميزة)</label>
          <textarea name="features_ar" rows={4} defaultValue={service?.features_ar.join("\n") ?? ""} className={`${input} resize-none`} placeholder={"ميزة ١\nميزة ٢\nميزة ٣"} />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <label className="mb-1 block text-sm font-medium">Icon name</label>
          <input name="icon" defaultValue={service?.icon ?? ""} className={input} placeholder="BookOpen" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Image URL</label>
          <input name="image_url" defaultValue={service?.image_url ?? ""} className={input} placeholder="https://..." dir="ltr" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Display Order</label>
          <input name="display_order" type="number" defaultValue={service?.display_order ?? 0} className={input} />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input type="checkbox" name="is_active" id="is_active" defaultChecked={service?.is_active ?? true} className="h-4 w-4 accent-gold" />
        <label htmlFor="is_active" className="text-sm">نشط / Active</label>
      </div>

      <button type="submit" disabled={pending} className="flex items-center gap-2 rounded-lg bg-gold px-6 py-2.5 text-sm font-semibold text-background hover:bg-gold-hover disabled:opacity-50">
        <Save size={16} />
        {pending ? "جاري الحفظ..." : "حفظ"}
      </button>
    </form>
  );
}
