import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ArticleForm } from "../../article-form";

export const metadata: Metadata = { title: "تعديل مقال" };

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EditHelpArticlePage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();

  const [articleRes, categoriesRes] = await Promise.all([
    supabase.from("help_articles")
      .select("id, slug, title_ar, title_en, body_ar, body_en, category, sort_order, is_published")
      .eq("id", id)
      .single<{
        id: string; slug: string;
        title_ar: string; title_en: string | null;
        body_ar: string; body_en: string | null;
        category: string; sort_order: number; is_published: boolean;
      }>(),
    supabase.from("help_categories")
      .select("slug, label_ar, label_en")
      .order("sort_order", { ascending: true })
      .returns<{ slug: string; label_ar: string; label_en: string | null }[]>(),
  ]);

  if (!articleRes.data) notFound();

  return (
    <ArticleForm
      categories={categoriesRes.data ?? []}
      initial={articleRes.data}
    />
  );
}
