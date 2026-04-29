import type { Metadata } from "next";
import { redirect, notFound } from "next/navigation";
import { FileText, Headphones, Link2, Video, Image as ImageIcon, ExternalLink, Download } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { isFeatureEnabled } from "@/lib/settings";

export const metadata: Metadata = { title: "المصادر" };

const TYPE_ICON: Record<string, React.ElementType> = {
  pdf: FileText,
  audio: Headphones,
  link: Link2,
  video: Video,
  image: ImageIcon,
};

interface PageProps {
  searchParams: Promise<{ type?: string; q?: string }>;
}

export default async function StudentResourcesPage({ searchParams }: PageProps) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  if (!(await isFeatureEnabled("resources_enabled"))) notFound();

  const sp = await searchParams;
  const filterType = sp.type ?? "all";
  const search = (sp.q ?? "").trim().toLowerCase();

  const { t, dir, lang } = await getT();

  let q = supabase.from("resources")
    .select("id, title_ar, title_en, description_ar, description_en, resource_type, file_url, external_url, category, tags")
    .eq("is_published", true)
    .order("created_at", { ascending: false });

  if (filterType !== "all" && (Object.keys(TYPE_ICON).includes(filterType))) {
    q = q.eq("resource_type", filterType);
  }

  const { data } = await q.returns<{
    id: string;
    title_ar: string; title_en: string | null;
    description_ar: string | null; description_en: string | null;
    resource_type: string;
    file_url: string | null; external_url: string | null;
    category: string; tags: string[];
  }[]>();

  const filtered = (data ?? []).filter((r) => {
    if (!search) return true;
    const hay = [
      r.title_ar, r.title_en, r.description_ar, r.description_en, ...r.tags,
    ].filter(Boolean).join(" ").toLowerCase();
    return hay.includes(search);
  });

  const types = ["all", "pdf", "audio", "link", "video", "image"];
  const typeLabels: Record<string, { ar: string; en: string }> = {
    all: { ar: "الكل", en: "All" },
    pdf: { ar: "PDF", en: "PDF" },
    audio: { ar: "صوت", en: "Audio" },
    link: { ar: "روابط", en: "Links" },
    video: { ar: "فيديو", en: "Video" },
    image: { ar: "صور", en: "Images" },
  };

  return (
    <div dir={dir} className="mx-auto max-w-[1200px] px-6 py-8 sm:px-8 sm:py-10">
      <h1 className="font-display text-3xl font-bold sm:text-4xl">
        {t("المصادر", "Resources")}
      </h1>
      <p className="mt-2 text-sm text-muted">
        {t("مكتبة من المراجع والملفات لدعم رحلتك في القرآن.",
           "A library of references and study materials for your Quran journey.")}
      </p>

      <form className="mt-6 flex flex-wrap items-center gap-2">
        <input
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder={t("بحث...", "Search...")}
          className="glass-input h-10 flex-1 rounded-lg px-3 text-sm"
        />
        <input type="hidden" name="type" value={filterType} />
        <button type="submit" className="glass-pill border border-[var(--surface-border)] px-4 py-2 text-sm">
          {t("بحث", "Search")}
        </button>
      </form>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {types.map((tp) => (
          <a
            key={tp}
            href={`?type=${tp}${search ? `&q=${encodeURIComponent(search)}` : ""}`}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              filterType === tp
                ? "border-gold bg-gold/10 text-gold"
                : "border-[var(--surface-border)] text-muted hover:text-foreground"
            }`}
          >
            {lang === "ar" ? typeLabels[tp].ar : typeLabels[tp].en}
          </a>
        ))}
      </div>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.length === 0 ? (
          <div className="glass-card col-span-full p-10 text-center text-sm text-muted">
            {t("لا توجد مصادر متطابقة بعد", "No matching resources yet")}
          </div>
        ) : (
          filtered.map((r) => {
            const Icon = TYPE_ICON[r.resource_type] ?? FileText;
            const title = lang === "ar" ? r.title_ar : (r.title_en ?? r.title_ar);
            const desc = lang === "ar" ? r.description_ar : (r.description_en ?? r.description_ar);
            const href = r.external_url || r.file_url || "#";
            const isExternal = Boolean(r.external_url);
            return (
              <a
                key={r.id}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="glass-card group hover-lift block p-5"
              >
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--surface-light,#F5F5F7)]">
                  <Icon size={18} className="text-gold" aria-hidden="true" />
                </div>
                <h3 className="line-clamp-2 text-sm font-semibold text-foreground">{title}</h3>
                {desc && (
                  <p className="mt-1 line-clamp-3 text-xs text-muted">{desc}</p>
                )}
                {r.tags.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1">
                    {r.tags.slice(0, 3).map((tg) => (
                      <span key={tg} className="rounded bg-[var(--surface-light)] px-1.5 py-0.5 text-[10px] text-muted">
                        {tg}
                      </span>
                    ))}
                  </div>
                )}
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-[11px] uppercase tracking-wider text-muted-light">
                    {r.resource_type}
                  </span>
                  {isExternal
                    ? <ExternalLink size={14} className="text-muted-light" aria-hidden="true" />
                    : <Download size={14} className="text-muted-light" aria-hidden="true" />}
                </div>
              </a>
            );
          })
        )}
      </div>
    </div>
  );
}
