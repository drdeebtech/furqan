import { createClient } from "@/lib/supabase/server";
import type { MetadataRoute } from "next";
import { BASE_URL } from "@/lib/constants";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = BASE_URL;

  // B7 fixes (senior-dev persona findings, decisions in wave 1):
  // - NO ?lang= alternates: the app never reads a lang query param (language is
  //   the furqan-lang cookie), so those alternate URLs all rendered identical
  //   content — invalid hreflang signals worse than none.
  // - NO lastModified on static pages: `new Date()` regenerated per request, so
  //   lastmod was always "now" and crawlers learn to distrust it. DB-backed
  //   entries below keep their real updated_at.
  const staticPages: MetadataRoute.Sitemap = [
    { url: baseUrl, changeFrequency: "weekly", priority: 1.0 },
    { url: `${baseUrl}/about`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${baseUrl}/services`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${baseUrl}/pricing`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${baseUrl}/teachers`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${baseUrl}/courses`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${baseUrl}/teach-with-us`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${baseUrl}/blog`, changeFrequency: "daily", priority: 0.9 },
    { url: `${baseUrl}/help`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${baseUrl}/contact`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${baseUrl}/privacy`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${baseUrl}/terms`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${baseUrl}/cookies`, changeFrequency: "yearly", priority: 0.3 },
  ];

  const supabase = await createClient();
  const { data: posts } = await supabase
    .from("blog_posts")
    .select("slug, updated_at")
    .eq("is_published", true)
    .returns<{ slug: string; updated_at: string }[]>();

  const blogPages: MetadataRoute.Sitemap = (posts ?? []).map((post) => ({
    url: `${baseUrl}/blog/${post.slug}`,
    lastModified: new Date(post.updated_at),
    changeFrequency: "monthly" as const,
    priority: 0.7,
  }));

  // Published course landing pages — highest-intent long-tail acquisition
  // surfaces, so they carry a higher priority (0.8) than blog/help (0.7/0.5).
  const { data: courses } = await supabase
    .from("courses")
    .select("slug, updated_at")
    .eq("status", "published")
    .is("deleted_at", null)
    .returns<{ slug: string; updated_at: string }[]>();

  const coursePages: MetadataRoute.Sitemap = (courses ?? []).map((course) => ({
    url: `${baseUrl}/courses/${course.slug}`,
    lastModified: new Date(course.updated_at),
    changeFrequency: "weekly" as const,
    priority: 0.8,
  }));

  // Published help-center articles — long-tail informational queries.
  const { data: helpArticles } = await supabase
    .from("help_articles")
    .select("slug, updated_at")
    .eq("is_published", true)
    .returns<{ slug: string; updated_at: string }[]>();

  const helpPages: MetadataRoute.Sitemap = (helpArticles ?? []).map((article) => ({
    url: `${baseUrl}/help/${article.slug}`,
    lastModified: new Date(article.updated_at),
    changeFrequency: "monthly" as const,
    priority: 0.5,
  }));

  return [...staticPages, ...blogPages, ...coursePages, ...helpPages];
}
