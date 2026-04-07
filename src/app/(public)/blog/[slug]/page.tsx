import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { BlogPost } from "@/types/blog";
import { RegisterBanner } from "@/components/public/register-banner";
import { BreadcrumbSchema } from "@/components/seo/structured-data";

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
  const supabase = await createClient();

  const { data: post } = await supabase
    .from("blog_posts")
    .select("*")
    .eq("slug", slug)
    .eq("is_published", true)
    .single<BlogPost>();

  if (!post) redirect("/blog");

  const date = new Date(post.published_at).toLocaleDateString("ar-SA", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div dir="rtl">
      <BreadcrumbSchema items={[
        { name: "الرئيسية", url: "https://furqan.today" },
        { name: "المدونة", url: "https://furqan.today/blog" },
        { name: post.title_ar, url: `https://furqan.today/blog/${post.slug}` },
      ]} />
      <section className="border-b border-card-border bg-card py-16 text-center">
        <p className="text-sm text-muted">
          <Link href="/" className="text-gold hover:text-gold-light">الرئيسية</Link>
          {" / "}
          <Link href="/blog" className="text-gold hover:text-gold-light">المدونة</Link>
          {" / "}
          {post.title_ar}
        </p>
        <span className={`mt-4 inline-block rounded-full border px-3 py-1 text-xs ${post.color}`}>
          {post.category_ar}
        </span>
        <h1 className="font-display mx-auto mt-4 max-w-2xl text-4xl font-bold">
          {post.title_ar}
        </h1>
        <p className="mt-2 text-sm text-muted">{post.title_en}</p>
        <p className="mt-3 text-sm text-muted">
          {date} · {post.read_time_ar} للقراءة
        </p>
      </section>

      <section className="py-24">
        <div className="mx-auto max-w-3xl px-6">
          {/* Arabic body */}
          <div className="whitespace-pre-line text-base leading-loose text-foreground">
            {post.body_ar}
          </div>

          {/* English body */}
          <div dir="ltr" className="mt-12 border-t border-card-border pt-8 text-left">
            <p className="mb-4 text-xs font-medium text-gold">English Version</p>
            <div className="whitespace-pre-line text-sm leading-relaxed text-muted">
              {post.body_en}
            </div>
          </div>

          <div className="mt-12">
            <Link href="/blog" className="text-sm text-gold transition-colors hover:text-gold-light">
              → العودة للمدونة · Back to Blog
            </Link>
          </div>
        </div>
      </section>

      <RegisterBanner />
    </div>
  );
}
