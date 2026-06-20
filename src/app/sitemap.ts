import { createClient } from "@/lib/supabase/server";
import type { MetadataRoute } from "next";
import { BASE_URL } from "@/lib/constants";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = BASE_URL;

  const altLangs = (path: string) => ({
    languages: {
      ar: `${baseUrl}${path}?lang=ar`,
      en: `${baseUrl}${path}?lang=en`,
      "x-default": `${baseUrl}${path}`,
    },
  });

  const staticPages: MetadataRoute.Sitemap = [
    { url: baseUrl, lastModified: new Date(), changeFrequency: "weekly", priority: 1.0, alternates: altLangs("/") },
    { url: `${baseUrl}/about`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.8, alternates: altLangs("/about") },
    { url: `${baseUrl}/services`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.9, alternates: altLangs("/services") },
    { url: `${baseUrl}/pricing`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.9, alternates: altLangs("/pricing") },
    { url: `${baseUrl}/teachers`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.8, alternates: altLangs("/teachers") },
    { url: `${baseUrl}/teach-with-us`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.8, alternates: altLangs("/teach-with-us") },
    { url: `${baseUrl}/blog`, lastModified: new Date(), changeFrequency: "daily", priority: 0.9, alternates: altLangs("/blog") },
    { url: `${baseUrl}/contact`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.7, alternates: altLangs("/contact") },
    { url: `${baseUrl}/privacy`, lastModified: new Date(), changeFrequency: "yearly", priority: 0.3 },
    { url: `${baseUrl}/terms`, lastModified: new Date(), changeFrequency: "yearly", priority: 0.3 },
    { url: `${baseUrl}/cookies`, lastModified: new Date(), changeFrequency: "yearly", priority: 0.3 },
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

  return [...staticPages, ...blogPages];
}
