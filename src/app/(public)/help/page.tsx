import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, BookOpen, ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { isFeatureEnabled } from "@/lib/settings";
import { notFound } from "next/navigation";

export const metadata: Metadata = { title: "مركز المساعدة" };

export default async function HelpCenterIndexPage() {
  if (!(await isFeatureEnabled("help_center_enabled"))) notFound();

  const { t, dir, lang } = await getT();
  const supabase = await createClient();

  // Detect logged-in user so we can render a "back to dashboard" banner —
  // without it, the public chrome makes users think /help signed them out.
  const { data: { user } } = await supabase.auth.getUser();
  let dashboardHref: string | null = null;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single<{ role: "student" | "teacher" | "admin" | null }>();
    const role = profile?.role;
    if (role === "student") dashboardHref = "/student/dashboard";
    else if (role === "teacher") dashboardHref = "/teacher/dashboard";
    else if (role === "admin") dashboardHref = "/admin/dashboard";
  }

  const [categoriesRes, articlesRes] = await Promise.all([
    supabase
      .from("help_categories")
      .select("slug, label_ar, label_en, sort_order")
      .order("sort_order", { ascending: true })
      .returns<{ slug: string; label_ar: string; label_en: string | null; sort_order: number }[]>(),
    supabase
      .from("help_articles")
      .select("id, slug, title_ar, title_en, category, sort_order")
      .eq("is_published", true)
      .order("sort_order", { ascending: true })
      .returns<{ id: string; slug: string; title_ar: string; title_en: string | null; category: string; sort_order: number }[]>(),
  ]);

  const categories = categoriesRes.data ?? [];
  const articles = articlesRes.data ?? [];
  const articlesByCat: Record<string, typeof articles> = {};
  for (const a of articles) {
    (articlesByCat[a.category] ||= [] as typeof articles).push(a);
  }

  return (
    <div dir={dir} className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      {dashboardHref && (
        <div className="mb-6 flex items-center justify-between gap-3 border-b border-card-border/60 pb-4 text-sm">
          <span className="text-muted">
            {t("مركز المساعدة — يمكنك العودة إلى لوحة التحكم في أي وقت.",
               "Help Center — return to your dashboard anytime.")}
          </span>
          <Link href={dashboardHref} className="shrink-0 font-medium text-gold hover:text-gold-hover focus-ring rounded">
            {t("العودة للوحة التحكم", "Back to dashboard")}
          </Link>
        </div>
      )}
      <div className="mb-10 text-center">
        <BookOpen size={32} className="mx-auto mb-3 text-gold" aria-hidden="true" />
        <h1 className="font-display text-3xl font-bold sm:text-4xl">
          {t("مركز المساعدة", "Help Center")}
        </h1>
        <p className="mt-2 text-muted">
          {t("إجابات على الأسئلة الشائعة وأدلة مختصرة لاستخدام أكاديمية فُرقان.",
             "Answers to common questions and short guides for using FURQAN Academy.")}
        </p>
      </div>

      {articles.length === 0 ? (
        <div className="glass-card p-8 text-center text-sm text-muted">
          {t("لا توجد مقالات بعد. تابعنا قريبًا.",
             "No articles yet. Check back soon.")}
        </div>
      ) : (
        <div className="space-y-8">
          {categories.map((cat) => {
            const catArticles = articlesByCat[cat.slug] ?? [];
            if (catArticles.length === 0) return null;
            return (
              <section key={cat.slug}>
                <h2 className="mb-3 text-xs font-medium uppercase tracking-[0.08em] text-muted-light">
                  {lang === "ar" ? cat.label_ar : (cat.label_en ?? cat.label_ar)}
                </h2>
                <ul className="glass-card divide-y divide-[var(--surface-divider,#F0F0F2)] overflow-hidden">
                  {catArticles.map((a) => (
                    <li key={a.id}>
                      <Link
                        href={`/help/${a.slug}`}
                        className="flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-foreground/5"
                      >
                        <span className="text-sm font-medium text-foreground">
                          {lang === "ar" ? a.title_ar : (a.title_en ?? a.title_ar)}
                        </span>
                        {dir === "rtl"
                          ? <ChevronRight size={16} className="rotate-180 text-muted" aria-hidden="true" />
                          : <ChevronRight size={16} className="text-muted" aria-hidden="true" />}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      <div className="mt-10 text-center text-sm text-muted">
        {t("لم تجد ما تبحث عنه؟", "Can't find what you're looking for?")}{" "}
        <a
          href="https://wa.me/96597795626"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-gold hover:text-gold-hover"
        >
          {t("تواصل معنا", "Contact us")}
          <ArrowRight size={12} className={dir === "rtl" ? "rotate-180" : ""} aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}
