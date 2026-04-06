import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { BlogPost } from "@/types/blog";
import { RegisterBanner } from "@/components/public/free-trial-banner";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: post } = await supabase
    .from("blog_posts")
    .select("title_ar, excerpt_ar, slug")
    .eq("slug", slug)
    .eq("is_published", true)
    .single<{ title_ar: string; excerpt_ar: string; slug: string }>();

  if (!post) return { title: "مقال" };

  return {
    title: post.title_ar,
    description: post.excerpt_ar,
    alternates: { canonical: `https://furqan.today/blog/${post.slug}` },
    openGraph: {
      title: post.title_ar,
      description: post.excerpt_ar,
      type: "article",
      url: `https://furqan.today/blog/${post.slug}`,
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
