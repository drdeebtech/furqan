import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import type { BlogPost } from "@/types/blog";
import { BlogContent } from "./content";

export const metadata: Metadata = { title: "المدونة" };

export default async function BlogPage() {
  const supabase = await createClient();

  const { data: posts } = await supabase
    .from("blog_posts")
    .select("slug, title_ar, title_en, excerpt_ar, excerpt_en, category_ar, category_en, color, read_time_ar, read_time_en, published_at")
    .eq("is_published", true)
    .order("published_at", { ascending: false })
    .returns<Omit<BlogPost, "id" | "body_ar" | "body_en" | "is_published" | "created_at" | "updated_at">[]>();

  return <BlogContent posts={posts ?? []} />;
}
