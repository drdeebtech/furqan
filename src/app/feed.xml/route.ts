import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: posts } = await supabase
    .from("blog_posts")
    .select("slug, title_ar, title_en, excerpt_ar, excerpt_en, published_at")
    .eq("is_published", true)
    .order("published_at", { ascending: false })
    .limit(50)
    .returns<
      {
        slug: string;
        title_ar: string;
        title_en: string;
        excerpt_ar: string;
        excerpt_en: string;
        published_at: string;
      }[]
    >();

  const items = (posts ?? [])
    .map(
      (p) => `    <item>
      <title><![CDATA[${p.title_ar}]]></title>
      <link>https://furqan.today/blog/${p.slug}</link>
      <guid isPermaLink="true">https://furqan.today/blog/${p.slug}</guid>
      <description><![CDATA[${p.excerpt_ar}]]></description>
      <pubDate>${new Date(p.published_at).toUTCString()}</pubDate>
    </item>`,
    )
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>فرقان — المدونة</title>
    <link>https://furqan.today/blog</link>
    <description>مقالات ونصائح لتعلم القرآن الكريم من أكاديمية فرقان</description>
    <language>ar</language>
    <atom:link href="https://furqan.today/feed.xml" rel="self" type="application/rss+xml"/>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
