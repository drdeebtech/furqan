import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { isFeatureEnabled } from "@/lib/settings";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("help_articles")
    .select("title_ar, title_en")
    .eq("slug", slug)
    .eq("is_published", true)
    .single<{ title_ar: string; title_en: string | null }>();
  if (!data) return { title: "مركز المساعدة" };
  return { title: `${data.title_ar} | مركز المساعدة` };
}

export default async function HelpArticlePage({ params }: Props) {
  if (!(await isFeatureEnabled("help_center_enabled"))) notFound();

  const { slug } = await params;
  const { t, dir, lang } = await getT();
  const supabase = await createClient();

  const { data: article } = await supabase
    .from("help_articles")
    .select("id, slug, title_ar, title_en, body_ar, body_en, category, updated_at")
    .eq("slug", slug)
    .eq("is_published", true)
    .single<{
      id: string; slug: string;
      title_ar: string; title_en: string | null;
      body_ar: string; body_en: string | null;
      category: string; updated_at: string;
    }>();

  if (!article) notFound();

  const title = lang === "ar" ? article.title_ar : (article.title_en ?? article.title_ar);
  const body = lang === "ar" ? article.body_ar : (article.body_en ?? article.body_ar);

  const Arrow = dir === "rtl" ? ArrowRight : ArrowLeft;

  return (
    <div dir={dir} className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <Link
        href="/help"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground"
      >
        <Arrow size={14} aria-hidden="true" />
        {t("العودة لمركز المساعدة", "Back to Help Center")}
      </Link>

      <article className="glass-card p-6 sm:p-10">
        <h1 className="font-display text-2xl font-bold sm:text-3xl">{title}</h1>
        <p className="mt-2 text-xs text-muted-light">
          {t("آخر تحديث:", "Last updated:")}{" "}
          {new Date(article.updated_at).toLocaleDateString(lang === "ar" ? "ar" : "en-US", {
            year: "numeric", month: "long", day: "numeric",
          })}
        </p>
        <div className="mt-6 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
          {body}
        </div>
      </article>
    </div>
  );
}
