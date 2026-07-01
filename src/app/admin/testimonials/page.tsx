import type { Metadata } from "next";
import Link from "next/link";
import { Quote, Plus, Inbox } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Testimonial } from "@/types/database";
import { getT } from "@/lib/i18n/server";
import { TestimonialRowActions } from "./testimonial-row-actions";
import { EmptyState } from "@/components/shared/empty-state";

export const metadata: Metadata = { title: "الشهادات · Testimonials" };

export default async function AdminTestimonialsPage() {
  const { t, dir, lang } = await getT();
  // admin: full testimonial list incl. unpublished drafts (admin-only view).
  const supabase = createAdminClient();

  const { data: rows, error } = await supabase
    .from("testimonials")
    .select("id, author_name, author_location, quote_ar, quote_en, teacher_id, is_published, display_order, created_at")
    .order("is_published", { ascending: false })
    .order("display_order", { ascending: true })
    .returns<Testimonial[]>();

  if (error) throw error;
  const all = rows ?? [];
  const published = all.filter((r) => r.is_published);
  const drafts = all.filter((r) => !r.is_published);

  return (
    <div dir={dir} className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Quote size={24} className="text-gold" />
          <h1 className="text-xl font-bold">{t("الشهادات", "Testimonials")}</h1>
        </div>
        <Link
          href="/admin/testimonials/new"
          className="glass-gold glass-pill flex items-center gap-2 px-4 py-2 text-sm font-semibold"
        >
          <Plus size={14} /> {t("شهادة جديدة", "New Testimonial")}
        </Link>
      </header>

      <p className="mb-6 text-xs text-muted">
        {t(
          "تظهر للزوار الشهادات المنشورة فقط. راجع المسودات وتحقق من صحتها قبل نشرها — لا تنشر محتوى غير موثّق.",
          "Only published testimonials are shown to visitors. Review drafts and verify them before publishing — never publish unverified content.",
        )}
      </p>

      {all.length === 0 ? (
        <EmptyState
          variant="glass-card"
          icon={<Inbox size={32} className="text-muted" aria-hidden="true" />}
          message={t("لا توجد شهادات بعد", "No testimonials yet")}
          hint={t("أضف شهادة موثّقة لعرضها على الموقع.", "Add a verified testimonial to display it on the site.")}
        />
      ) : (
        <>
          <Section title={t("منشورة", "Published")} rows={published} lang={lang} />
          <Section title={t("مسودات", "Drafts")} rows={drafts} lang={lang} muted />
        </>
      )}
    </div>
  );
}

function Section({
  title,
  rows,
  lang,
  muted,
}: {
  title: string;
  rows: Testimonial[];
  lang: "ar" | "en";
  muted?: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <section className={muted ? "opacity-70" : ""}>
      <h2 className="mb-3 mt-8 text-sm font-medium uppercase tracking-[0.2em] text-muted">
        {title} ({rows.length})
      </h2>
      <ul className="space-y-2">
        {rows.map((r) => {
          const quote = lang === "ar" ? r.quote_ar : r.quote_en || r.quote_ar;
          return (
            <li
              key={r.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-surface-border/60 bg-surface/40 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{quote}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {r.author_name}
                  {r.author_location ? ` · ${r.author_location}` : ""}
                </p>
              </div>
              <TestimonialRowActions id={r.id} isPublished={r.is_published} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
