import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import type { BlogPost } from "@/types/blog";
import { RegisterBanner } from "@/components/public/register-banner";
import { BreadcrumbSchema, ArticleSchema } from "@/components/seo/structured-data";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: post } = await supabase
    .from("blog_posts")
    .select("title_ar, excerpt_ar, slug, published_at, updated_at")
    .eq("slug", slug)
    .eq("is_published", true)
    .single<{ title_ar: string; excerpt_ar: string; slug: string; published_at: string; updated_at: string }>();

  if (!post) return { title: "مقال" };

  const url = `https://furqan.today/blog/${post.slug}`;
  const ogImage = `${url}/opengraph-image`;

  return {
    title: post.title_ar,
    description: post.excerpt_ar,
    alternates: { canonical: url },
    openGraph: {
      title: post.title_ar,
      description: post.excerpt_ar,
      type: "article",
      url,
      siteName: "فرقان — FURQAN Academy",
      locale: "ar_AR",
      publishedTime: post.published_at,
      modifiedTime: post.updated_at,
      authors: ["FURQAN Academy"],
      images: [{ url: ogImage, width: 1200, height: 630, alt: post.title_ar }],
    },
    twitter: {
      card: "summary_large_image",
      title: post.title_ar,
      description: post.excerpt_ar,
      images: [ogImage],
    },
  };
}

export default async function ArticlePage({ params }: Props) {
  const { slug } = await params;
  const { t, dir, lang } = await getT();
  const locale = lang === "ar" ? "ar-SA" : "en-US";
  const supabase = await createClient();

  const { data: post } = await supabase
    .from("blog_posts")
    .select("*")
    .eq("slug", slug)
    .eq("is_published", true)
    .single<BlogPost>();

  if (!post) redirect("/blog");

  const title = lang === "ar" ? post.title_ar : post.title_en;
  const category = lang === "ar" ? post.category_ar : post.category_en;
  const body = lang === "ar" ? post.body_ar : post.body_en;
  const readTime = lang === "ar" ? post.read_time_ar : post.read_time_en;
  const excerpt = lang === "ar" ? post.excerpt_ar : post.excerpt_en;

  const date = new Date(post.published_at).toLocaleDateString(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div dir={dir}>
      <BreadcrumbSchema items={[
        { name: t("الرئيسية", "Home"), url: "https://furqan.today" },
        { name: t("المدونة", "Blog"), url: "https://furqan.today/blog" },
        { name: title, url: `https://furqan.today/blog/${post.slug}` },
      ]} />
      <ArticleSchema
        headline={title}
        image={`https://furqan.today/blog/${post.slug}/opengraph-image`}
        datePublished={post.published_at}
        dateModified={post.updated_at}
        description={excerpt}
        url={`https://furqan.today/blog/${post.slug}`}
      />
      <section className="glass-card border-b border-white/10 py-16 text-center">
        <p className="text-sm text-muted">
          <Link href="/" className="text-gold hover:text-gold-light">{t("الرئيسية", "Home")}</Link>
          {" / "}
          <Link href="/blog" className="text-gold hover:text-gold-light">{t("المدونة", "Blog")}</Link>
          {" / "}
          {title}
        </p>
        <span className={`glass-badge mt-4 inline-block px-3 py-1 text-xs ${post.color}`}>
          {category}
        </span>
        <h1 className="font-display mx-auto mt-4 max-w-2xl text-4xl font-bold leading-tight">
          {title}
        </h1>
        <p className="mt-3 text-sm text-muted">
          {date} · {readTime} {t("للقراءة", "read")}
        </p>
      </section>

      <section className="py-24">
        <div className="mx-auto max-w-3xl px-6">
          <div className="whitespace-pre-line text-base leading-loose text-foreground">
            {body}
          </div>

          <div className="mt-12">
            <Link href="/blog" className="text-sm text-gold transition-colors hover:text-gold-light">
              {t("→ العودة للمدونة", "← Back to Blog")}
            </Link>
          </div>
        </div>
      </section>

      <RegisterBanner />
    </div>
  );
}
