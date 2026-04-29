import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Pencil, ExternalLink, Download } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "المصادر (إدارة)" };

export default async function AdminResourcesPage() {
  const { t, dir, lang } = await getT();
  const supabase = await createClient();

  const { data: resources } = await supabase
    .from("resources")
    .select("id, title_ar, title_en, resource_type, category, is_published, file_url, external_url, updated_at")
    .order("updated_at", { ascending: false })
    .returns<{
      id: string;
      title_ar: string; title_en: string | null;
      resource_type: string; category: string;
      is_published: boolean;
      file_url: string | null; external_url: string | null;
      updated_at: string;
    }[]>();

  const list = resources ?? [];

  return (
    <div dir={dir} className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="font-display text-xl font-bold sm:text-2xl">
          {t("المصادر", "Resources")}
        </h1>
        <Link
          href="/admin/resources/new"
          className="glass-gold glass-pill inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold"
        >
          <Plus size={14} aria-hidden="true" /> {t("إضافة مصدر", "New Resource")}
        </Link>
      </header>

      {list.length === 0 ? (
        <div className="glass-card p-10 text-center text-muted">
          {t("لا توجد مصادر بعد", "No resources yet")}
        </div>
      ) : (
        <ul className="glass-card divide-y divide-[var(--surface-divider,#F0F0F2)] overflow-hidden">
          {list.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {lang === "ar" ? r.title_ar : (r.title_en ?? r.title_ar)}
                </p>
                <p className="mt-0.5 truncate text-[11px] text-muted">
                  {r.resource_type.toUpperCase()} · {r.category}
                  {r.external_url && <> · <ExternalLink size={10} className="inline" aria-hidden="true" /> link</>}
                  {r.file_url && <> · <Download size={10} className="inline" aria-hidden="true" /> file</>}
                </p>
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  r.is_published
                    ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                    : "border border-[var(--surface-border)] text-muted"
                }`}
              >
                {r.is_published ? t("منشور", "Published") : t("مسودة", "Draft")}
              </span>
              <Link
                href={`/admin/resources/${r.id}/edit`}
                aria-label={t("تعديل", "Edit")}
                className="rounded p-1.5 text-muted transition-colors hover:text-foreground"
              >
                <Pencil size={14} aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
