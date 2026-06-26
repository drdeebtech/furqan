import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import { addCacheTag } from "@vercel/functions";
import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/logger";
import type { BlogPost } from "@/types/blog";
import type { SiteBlogCategory } from "@/lib/site-content/types";
import { BlogContent } from "./content";
import { BreadcrumbSchema } from "@/components/seo/structured-data";

// Cache the blog index (posts + categories) at the Next.js Data Cache
// layer. Same rationale as /teachers — the (public) layout reads
// cookies, so the route stays ƒ (dynamic) and we can't get full CDN
// ISR. The 10-min cache window still drops the 50+ row select cost
// to a single shared fetch across every public visitor.
const getBlogIndex = unstable_cache(
  async () => {
    // admin: public anonymous read of published blog (issue #523)
    const supabase = createAdminClient();
    const [postsRes, categoriesRes] = await Promise.all([
      supabase
        .from("blog_posts")
        .select("slug, title_ar, title_en, excerpt_ar, excerpt_en, category_ar, category_en, color, read_time_ar, read_time_en, published_at, cover_image_path, cover_alt_en, cover_alt_ar")
        .eq("is_published", true)
        .order("published_at", { ascending: false })
        .returns<Omit<BlogPost, "id" | "body_ar" | "body_en" | "is_published" | "created_at" | "updated_at">[]>(),
      supabase
        .from("site_blog_categories")
        .select("id, key, label_ar, label_en, sort_order, is_active")
        .eq("is_active", true)
        .order("sort_order")
        .returns<SiteBlogCategory[]>(),
    ]);

    // Surface query errors instead of silently returning [] — the
    // `?? []` defaults below keep the page rendering, but Sentry now
    // sees the failure. (Closes the silent-fail baseline regression
    // introduced when this route was wrapped in unstable_cache.)
    if (postsRes.error) {
      logError("public blog: posts query failed", postsRes.error, { tag: "public-blog" });
    }
    if (categoriesRes.error) {
      logError("public blog: categories query failed", categoriesRes.error, { tag: "public-blog" });
    }

    return {
      posts: postsRes.data ?? [],
      categories: (categoriesRes.data ?? []).map(c => ({ key: c.key, ar: c.label_ar, en: c.label_en })),
    };
  },
  ["public-blog-index"],
  { tags: ["blog-public"], revalidate: 600 },
);

export const metadata: Metadata = {
  title: "المدونة — مقالات في علوم القرآن",
  description: "مقالات ونصائح في حفظ القرآن والتجويد والتلاوة من معلمي أكاديمية فرقان.",
  alternates: {
    canonical: "https://www.furqan.today/blog",
    types: { "application/rss+xml": "https://www.furqan.today/feed.xml" },
  },
};

// ISR — blog index changes when admin publishes a new post. 10-minute
// cache turns the 50+ row select on every visit into a CDN edge
// response. Admin publishing already calls revalidatePath('/blog') for
// immediate freshness; the 10-min ceiling is just worst-case staleness.
export const revalidate = 600;

export default async function BlogPage() {
  await addCacheTag("blog-public");

  const { posts, categories } = await getBlogIndex();

  return (
    <>
      <BreadcrumbSchema items={[
        { name: "الرئيسية", url: "https://www.furqan.today" },
        { name: "المدونة", url: "https://www.furqan.today/blog" },
      ]} />
      <BlogContent posts={posts} categories={categories} />
    </>
  );
}
