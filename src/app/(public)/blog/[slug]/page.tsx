import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Image from "next/image";
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
    .select("title_ar, title_en, excerpt_ar, excerpt_en, slug, published_at, updated_at")
    .eq("slug", slug)
    .eq("is_published", true)
    // maybeSingle(): an unknown slug is a valid miss (bots probe /blog/wp-login.php),
    // not an error. .single() returns HTTP 406 + PGRST116, which createObservedFetch
    // reports to Sentry — the code already handles null below (Sentry FURQAN-4G/4B).
    .maybeSingle<{
      title_ar: string;
      title_en: string | null;
      excerpt_ar: string;
      excerpt_en: string | null;
      slug: string;
      published_at: string;
      updated_at: string;
    }>();

  if (!post) return { title: "مقال" };

  const url = `https://www.furqan.today/blog/${post.slug}`;
  const ogImage = `${url}/opengraph-image`;
  // Bilingual title mirrors the help/[slug] pattern: Arabic primary, English
  // appended when present. Description prefers the Arabic excerpt (primary
  // audience), falling back to the English excerpt only if Arabic is empty.
  const title = post.title_en ? `${post.title_ar} — ${post.title_en}` : post.title_ar;
  const description = post.excerpt_ar || post.excerpt_en || "";

  return {
    title,
    description,
    alternates: {
      canonical: url,
      languages: {
        ar: `${url}?lang=ar`,
        en: `${url}?lang=en`,
        "x-default": url,
      },
    },
    openGraph: {
      title,
      description,
      type: "article",
      url,
      siteName: "فرقان — FURQAN Academy",
      locale: "ar_AR",
      publishedTime: post.published_at,
      modifiedTime: post.updated_at,
      authors: ["FURQAN Academy"],
      images: [{ url: ogImage, width: 1200, height: 630, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
    },
  };
}

export default async function ArticlePage({ params }: Props) {
  const { slug } = await params;
  const { t, dir, lang } = await getT();
  const locale = lang === "ar" ? "ar-EG" : "en-US";
  const supabase = await createClient();

  const { data: post } = await supabase
    .from("blog_posts")
    .select("*")
    .eq("slug", slug)
    .eq("is_published", true)
    // maybeSingle(): same as generateMetadata above — an unknown slug is a miss,
    // handled by the redirect below, not a 406 worth paging Sentry over.
    .maybeSingle<BlogPost>();

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

  const coverUrl = post.cover_image_path
    ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/blog-images/${post.cover_image_path}`
    : null;
  const coverAlt = (lang === "ar" ? post.cover_alt_ar : post.cover_alt_en) ?? "";

  return (
    <div dir={dir}>
      <BreadcrumbSchema items={[
        { name: t("الرئيسية", "Home"), url: "https://www.furqan.today" },
        { name: t("المدونة", "Blog"), url: "https://www.furqan.today/blog" },
        { name: title, url: `https://www.furqan.today/blog/${post.slug}` },
      ]} />
      <ArticleSchema
        headline={title}
        image={`https://www.furqan.today/blog/${post.slug}/opengraph-image`}
        datePublished={post.published_at}
        dateModified={post.updated_at}
        description={excerpt}
        url={`https://www.furqan.today/blog/${post.slug}`}
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

      {coverUrl && (
        <section className="border-b border-white/10 bg-background">
          <div className="mx-auto max-w-4xl px-6 py-8">
            <Image
              src={coverUrl}
              alt={coverAlt}
              width={1280}
              height={720}
              className="h-auto w-full rounded-2xl border border-white/10 object-cover"
              priority
            />
          </div>
        </section>
      )}

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
