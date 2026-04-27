export interface SiteFaq {
  id: string;
  sort_order: number;
  question_ar: string;
  question_en: string;
  answer_ar: string;
  answer_en: string;
  is_active: boolean;
}

export interface SiteFeature {
  id: string;
  slot: string;
  sort_order: number;
  icon_name: string;
  title_ar: string;
  title_en: string;
  description_ar: string | null;
  description_en: string | null;
  meta: Record<string, unknown>;
  is_active: boolean;
}

export interface SiteBlogCategory {
  id: string;
  key: string;
  label_ar: string;
  label_en: string;
  sort_order: number;
  is_active: boolean;
}

export interface TeacherLanguage {
  key: string;
  label_ar: string;
  label_en: string;
  sort_order: number;
  is_active: boolean;
}

// Slot-specific meta types — runtime-typed via the meta jsonb column.
export interface SubjectMeta {
  level_ar?: string;
  level_en?: string;
}
export interface PackagePreviewMeta {
  freq_ar?: string;
  freq_en?: string;
  featured?: boolean;
}

export type SiteFeatureSlot =
  | "home_how_it_works"
  | "home_why_us"
  | "home_subjects"
  | "home_trust_strip"
  | "home_package_preview"
  | "about_values";
