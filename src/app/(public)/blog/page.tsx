import type { Metadata } from "next";
import { addCacheTag } from "@vercel/functions";
import { createClient } from "@/lib/supabase/server";
import type { BlogPost } from "@/types/blog";
import { BlogContent } from "./content";
import { BreadcrumbSchema } from "@/components/seo/structured-data";
import { getActiveBlogCategories } from "@/lib/site-content/queries";

export const metadata: Metadata = {
  title: "المدونة — مقالات في علوم القرآن",
  description: "مقالات ونصائح في حفظ القرآن والتجويد والتلاوة من معلمي أكاديمية فرقان.",
  alternates: {
    canonical: "https://furqan.today/blog",
    types: { "application/rss+xml": "https://furqan.today/feed.xml" },
  },
};

// ISR — blog index changes when admin publishes a new post. 10-minute
// cache turns the 50+ row select on every visit into a CDN edge
// response. Admin publishing already calls revalidatePath('/blog') for
// immediate freshness; the 10-min ceiling is just worst-case staleness.
export const revalidate = 600;

export default async function BlogPage() {
  // Tag the CDN-cached response so admin publishing can invalidate
  // the global edge copy via invalidateByTag('blog-public') in addition
  // to the existing revalidatePath('/blog') call.
  await addCacheTag("blog-public");

  const supabase = await createClient();

  const [postsRes, dbCategories] = await Promise.all([
    supabase
      .from("blog_posts")
      .select("slug, title_ar, title_en, excerpt_ar, excerpt_en, category_ar, category_en, color, read_time_ar, read_time_en, published_at")
      .eq("is_published", true)
      .order("published_at", { ascending: false })
      .returns<Omit<BlogPost, "id" | "body_ar" | "body_en" | "is_published" | "created_at" | "updated_at">[]>(),
    getActiveBlogCategories(),
  ]);

  const categories = dbCategories.map(c => ({ key: c.key, ar: c.label_ar, en: c.label_en }));

  return (
    <>
      <BreadcrumbSchema items={[
        { name: "الرئيسية", url: "https://furqan.today" },
        { name: "المدونة", url: "https://furqan.today/blog" },
      ]} />
      <BlogContent posts={postsRes.data ?? []} categories={categories} />
    </>
  );
}
