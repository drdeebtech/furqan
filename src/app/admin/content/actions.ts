"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { loudAction, type LoudResult } from "@/lib/actions/loud";
import { requireAdmin } from "@/lib/auth/require-admin";

// Tables added in v16_001 — supabase.generated.ts not regenerated yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

function str(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length === 0 ? null : t;
}
function intOr(formData: FormData, key: string, def: number): number {
  const v = formData.get(key);
  if (typeof v !== "string") return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}
function bool(formData: FormData, key: string): boolean {
  return formData.get(key) === "on" || formData.get(key) === "true";
}

function revalidatePublicSurfaces() {
  revalidatePath("/");
  revalidatePath("/contact");
  revalidatePath("/about");
  revalidatePath("/blog");
  revalidatePath("/admin/content");
}

// ─── FAQ ───────────────────────────────────────────────────────────────

const upsertFaqBase = loudAction<{
  id: string | null;
  sort_order: number;
  question_ar: string;
  question_en: string;
  answer_ar: string;
  answer_en: string;
  is_active: boolean;
}, { message?: string }>({
  name: "admin.content.upsert-faq",
  severity: "info",
  audit: {
    table: "site_faqs",
    recordId: (i) => i.id ?? "(new)",
    action: "UPDATE",
    reasonPrefix: "admin upsert FAQ",
  },
  handler: async (input) => {
    const supabase = (await createClient()) as AnyClient;
    const row = {
      sort_order: input.sort_order,
      question_ar: input.question_ar,
      question_en: input.question_en,
      answer_ar: input.answer_ar,
      answer_en: input.answer_en,
      is_active: input.is_active,
    };
    const { error } = input.id
      ? await supabase.from("site_faqs").update(row).eq("id", input.id)
      : await supabase.from("site_faqs").insert(row);
    if (error) throw error;
    revalidatePublicSurfaces();
    return { message: input.id ? "تم الحفظ" : "تم إنشاء سؤال جديد" };
  },
});

export async function upsertFaq(_prev: LoudResult | null, formData: FormData): Promise<LoudResult> {
  try { await requireAdmin(); } catch { return { ok: false, error: "غير مصرح" }; }
  return upsertFaqBase({
    id: str(formData, "id"),
    sort_order: intOr(formData, "sort_order", 100),
    question_ar: str(formData, "question_ar") ?? "",
    question_en: str(formData, "question_en") ?? "",
    answer_ar: str(formData, "answer_ar") ?? "",
    answer_en: str(formData, "answer_en") ?? "",
    is_active: bool(formData, "is_active"),
  });
}

export async function deleteFaq(id: string): Promise<LoudResult> {
  try { await requireAdmin(); } catch { return { ok: false, error: "غير مصرح" }; }
  const supabase = (await createClient()) as AnyClient;
  const { error } = await supabase.from("site_faqs").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePublicSurfaces();
  return { ok: true, message: "تم الحذف" };
}

// ─── Features ──────────────────────────────────────────────────────────

const upsertFeatureBase = loudAction<{
  id: string | null;
  slot: string;
  sort_order: number;
  icon_name: string;
  title_ar: string;
  title_en: string;
  description_ar: string | null;
  description_en: string | null;
  meta: Record<string, unknown>;
  is_active: boolean;
}, { message?: string }>({
  name: "admin.content.upsert-feature",
  severity: "info",
  audit: {
    table: "site_features",
    recordId: (i) => i.id ?? "(new)",
    action: "UPDATE",
    reasonPrefix: "admin upsert feature",
  },
  handler: async (input) => {
    const supabase = (await createClient()) as AnyClient;
    const row = {
      slot: input.slot,
      sort_order: input.sort_order,
      icon_name: input.icon_name,
      title_ar: input.title_ar,
      title_en: input.title_en,
      description_ar: input.description_ar,
      description_en: input.description_en,
      meta: input.meta,
      is_active: input.is_active,
    };
    const { error } = input.id
      ? await supabase.from("site_features").update(row).eq("id", input.id)
      : await supabase.from("site_features").insert(row);
    if (error) throw error;
    revalidatePublicSurfaces();
    return { message: input.id ? "تم الحفظ" : "تم إنشاء عنصر جديد" };
  },
});

export async function upsertFeature(_prev: LoudResult | null, formData: FormData): Promise<LoudResult> {
  try { await requireAdmin(); } catch { return { ok: false, error: "غير مصرح" }; }
  // Build the meta jsonb from the slot-specific extra fields surfaced in the form.
  const meta: Record<string, unknown> = {};
  const levelAr = str(formData, "meta_level_ar");
  const levelEn = str(formData, "meta_level_en");
  const freqAr = str(formData, "meta_freq_ar");
  const freqEn = str(formData, "meta_freq_en");
  const featured = formData.get("meta_featured");
  if (levelAr) meta.level_ar = levelAr;
  if (levelEn) meta.level_en = levelEn;
  if (freqAr) meta.freq_ar = freqAr;
  if (freqEn) meta.freq_en = freqEn;
  if (featured === "on" || featured === "true") meta.featured = true;

  return upsertFeatureBase({
    id: str(formData, "id"),
    slot: str(formData, "slot") ?? "",
    sort_order: intOr(formData, "sort_order", 100),
    icon_name: str(formData, "icon_name") ?? "Star",
    title_ar: str(formData, "title_ar") ?? "",
    title_en: str(formData, "title_en") ?? "",
    description_ar: str(formData, "description_ar"),
    description_en: str(formData, "description_en"),
    meta,
    is_active: bool(formData, "is_active"),
  });
}

export async function deleteFeature(id: string): Promise<LoudResult> {
  try { await requireAdmin(); } catch { return { ok: false, error: "غير مصرح" }; }
  const supabase = (await createClient()) as AnyClient;
  const { error } = await supabase.from("site_features").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePublicSurfaces();
  return { ok: true, message: "تم الحذف" };
}

// ─── Blog Categories ───────────────────────────────────────────────────

const upsertCategoryBase = loudAction<{
  id: string | null;
  key: string;
  label_ar: string;
  label_en: string;
  sort_order: number;
  is_active: boolean;
}, { message?: string }>({
  name: "admin.content.upsert-category",
  severity: "info",
  audit: {
    table: "site_blog_categories",
    recordId: (i) => i.id ?? "(new)",
    action: "UPDATE",
    reasonPrefix: "admin upsert blog category",
  },
  handler: async (input) => {
    const supabase = (await createClient()) as AnyClient;
    const row = {
      key: input.key,
      label_ar: input.label_ar,
      label_en: input.label_en,
      sort_order: input.sort_order,
      is_active: input.is_active,
    };
    const { error } = input.id
      ? await supabase.from("site_blog_categories").update(row).eq("id", input.id)
      : await supabase.from("site_blog_categories").insert(row);
    if (error) throw error;
    revalidatePublicSurfaces();
    return { message: input.id ? "تم الحفظ" : "تم إنشاء تصنيف جديد" };
  },
});

export async function upsertCategory(_prev: LoudResult | null, formData: FormData): Promise<LoudResult> {
  try { await requireAdmin(); } catch { return { ok: false, error: "غير مصرح" }; }
  return upsertCategoryBase({
    id: str(formData, "id"),
    key: str(formData, "key") ?? "",
    label_ar: str(formData, "label_ar") ?? "",
    label_en: str(formData, "label_en") ?? "",
    sort_order: intOr(formData, "sort_order", 100),
    is_active: bool(formData, "is_active"),
  });
}

export async function deleteCategory(id: string): Promise<LoudResult> {
  try { await requireAdmin(); } catch { return { ok: false, error: "غير مصرح" }; }
  const supabase = (await createClient()) as AnyClient;
  const { error } = await supabase.from("site_blog_categories").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePublicSurfaces();
  return { ok: true, message: "تم الحذف" };
}
