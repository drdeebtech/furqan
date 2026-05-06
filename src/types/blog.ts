export interface BlogPost {
  id: string;
  slug: string;
  title_ar: string;
  title_en: string;
  excerpt_ar: string;
  excerpt_en: string;
  body_ar: string;
  body_en: string;
  category_ar: string;
  category_en: string;
  color: string;
  read_time_ar: string;
  read_time_en: string;
  published_at: string;
  is_published: boolean;
  created_at: string;
  updated_at: string;
  cover_image_path?: string | null;
  cover_alt_en?: string | null;
  cover_alt_ar?: string | null;
}
