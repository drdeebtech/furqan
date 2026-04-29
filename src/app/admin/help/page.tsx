import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Pencil } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "مركز المساعدة (إدارة)" };

export default async function AdminHelpListPage() {
  const { t, dir, lang } = await getT();
  const supabase = await createClient();

  const [articlesRes, categoriesRes] = await Promise.all([
    supabase.from("help_articles")
      .select("id, slug, title_ar, title_en, category, sort_order, is_published, updated_at")
      .order("category", { ascending: true })
      .order("sort_order", { ascending: true })
      .returns<{ id: string; slug: string; title_ar: string; title_en: string | null; category: string; sort_order: number; is_published: boolean; updated_at: string }[]>(),
    supabase.from("help_categories")
      .select("slug, label_ar, label_en")
      .returns<{ slug: string; label_ar: string; label_en: string | null }[]>(),
  ]);

  const articles = articlesRes.data ?? [];
  const catMap: Record<string, { ar: string; en: string }> = {};
  for (const c of categoriesRes.data ?? []) {
    catMap[c.slug] = { ar: c.label_ar, en: c.label_en ?? c.label_ar };
  }

  return (
    <div dir={dir} className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="font-display text-xl font-bold sm:text-2xl">
          {t("مركز المساعدة", "Help Center")}
        </h1>
        <Link
          href="/admin/help/new"
          className="glass-gold glass-pill inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold"
        >
          <Plus size={14} aria-hidden="true" /> {t("مقال جديد", "New Article")}
        </Link>
      </header>

      {articles.length === 0 ? (
        <div className="glass-card p-10 text-center text-muted">
          {t("لا توجد مقالات بعد", "No articles yet")}
        </div>
      ) : (
        <ul className="glass-card divide-y divide-[var(--surface-divider,#F0F0F2)] overflow-hidden">
          {articles.map((a) => {
            const catLabel = catMap[a.category];
            return (
              <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {lang === "ar" ? a.title_ar : (a.title_en ?? a.title_ar)}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-muted">
                    /{a.slug} · {catLabel ? (lang === "ar" ? catLabel.ar : catLabel.en) : a.category}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    a.is_published
                      ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                      : "border border-[var(--surface-border)] text-muted"
                  }`}
                >
                  {a.is_published ? t("منشور", "Published") : t("مسودة", "Draft")}
                </span>
                <Link
                  href={`/admin/help/${a.id}/edit`}
                  aria-label={t("تعديل", "Edit")}
                  className="rounded p-1.5 text-muted transition-colors hover:text-foreground"
                >
                  <Pencil size={14} aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
