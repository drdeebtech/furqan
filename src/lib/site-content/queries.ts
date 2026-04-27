import { createClient } from "@/lib/supabase/server";
import type { SiteFaq, SiteFeature, SiteBlogCategory, SiteFeatureSlot, TeacherLanguage } from "./types";

// site_faqs / site_features / site_blog_categories were added in v16_001 and
// src/types/supabase.generated.ts hasn't been regenerated yet. Same `as any`
// escape hatch the project uses for v15_008 picklist tables.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

export async function getActiveFaqs(): Promise<SiteFaq[]> {
  const supabase = (await createClient()) as AnyClient;
  const { data } = await supabase
    .from("site_faqs")
    .select("id, sort_order, question_ar, question_en, answer_ar, answer_en, is_active")
    .eq("is_active", true)
    .order("sort_order");
  return (data ?? []) as SiteFaq[];
}

export async function getFeaturesBySlot(slot: SiteFeatureSlot): Promise<SiteFeature[]> {
  const supabase = (await createClient()) as AnyClient;
  const { data } = await supabase
    .from("site_features")
    .select("id, slot, sort_order, icon_name, title_ar, title_en, description_ar, description_en, meta, is_active")
    .eq("slot", slot)
    .eq("is_active", true)
    .order("sort_order");
  return (data ?? []) as SiteFeature[];
}

export async function getActiveBlogCategories(): Promise<SiteBlogCategory[]> {
  const supabase = (await createClient()) as AnyClient;
  const { data } = await supabase
    .from("site_blog_categories")
    .select("id, key, label_ar, label_en, sort_order, is_active")
    .eq("is_active", true)
    .order("sort_order");
  return (data ?? []) as SiteBlogCategory[];
}

export async function getActiveTeacherLanguages(): Promise<TeacherLanguage[]> {
  return getPicklist("teacher_languages");
}

export async function getActiveTeacherSpecialties(): Promise<TeacherLanguage[]> {
  return getPicklist("teacher_specialties");
}

export async function getActiveTeacherRecitations(): Promise<TeacherLanguage[]> {
  return getPicklist("teacher_recitations");
}

async function getPicklist(table: "teacher_languages" | "teacher_specialties" | "teacher_recitations"): Promise<TeacherLanguage[]> {
  const supabase = (await createClient()) as AnyClient;
  const { data } = await supabase
    .from(table)
    .select("key, label_ar, label_en, sort_order, is_active")
    .eq("is_active", true)
    .order("sort_order");
  return (data ?? []) as TeacherLanguage[];
}

// Fetch all three teacher picklists in one parallel batch.
export async function getAllTeacherPicklists(): Promise<{
  languages: TeacherLanguage[];
  specialties: TeacherLanguage[];
  recitations: TeacherLanguage[];
}> {
  const [languages, specialties, recitations] = await Promise.all([
    getActiveTeacherLanguages(),
    getActiveTeacherSpecialties(),
    getActiveTeacherRecitations(),
  ]);
  return { languages, specialties, recitations };
}
