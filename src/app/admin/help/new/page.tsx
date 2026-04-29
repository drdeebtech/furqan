import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { ArticleForm } from "../article-form";

export const metadata: Metadata = { title: "مقال جديد" };

export default async function NewHelpArticlePage() {
  const supabase = await createClient();
  const { data: categories } = await supabase
    .from("help_categories")
    .select("slug, label_ar, label_en")
    .order("sort_order", { ascending: true })
    .returns<{ slug: string; label_ar: string; label_en: string | null }[]>();

  return <ArticleForm categories={categories ?? []} />;
}
