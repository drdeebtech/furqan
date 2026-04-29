"use client";

import { useActionState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";
import { ArrowLeft, ArrowRight, Trash2 } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { useToast } from "@/components/shared/toast";
import { saveArticle, deleteArticle, type HelpFormState } from "@/lib/actions/help";

interface Category {
  slug: string;
  label_ar: string;
  label_en: string | null;
}

interface ArticleInitial {
  id: string;
  slug: string;
  title_ar: string;
  title_en: string | null;
  body_ar: string;
  body_en: string | null;
  category: string;
  sort_order: number;
  is_published: boolean;
}

interface Props {
  categories: Category[];
  initial?: ArticleInitial;
}

const initialState: HelpFormState = {};

export function ArticleForm({ categories, initial }: Props) {
  const { t, dir, lang } = useLang();
  const router = useRouter();
  const toast = useToast();
  const [state, action, pending] = useActionState(saveArticle, initialState);
  const [deletePending, startDelete] = useTransition();

  useEffect(() => {
    if (state.ok) {
      toast.success(t("تم الحفظ", "Saved"));
      // After insert, navigate to the edit URL so subsequent saves are
      // updates not duplicates.
      if (state.id && !initial) router.push(`/admin/help/${state.id}/edit`);
    } else if (state.error) {
      toast.error(state.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const onDelete = () => {
    if (!initial) return;
    if (!confirm(t("حذف نهائي؟", "Delete permanently?"))) return;
    startDelete(async () => {
      const res = await deleteArticle(initial.id);
      if (res.ok) {
        toast.success(t("تم الحذف", "Deleted"));
        router.push("/admin/help");
      } else {
        toast.error(res.error ?? t("فشل الحذف", "Delete failed"));
      }
    });
  };

  const Arrow = dir === "rtl" ? ArrowRight : ArrowLeft;

  return (
    <div dir={dir} className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <Link
        href="/admin/help"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground"
      >
        <Arrow size={14} aria-hidden="true" />
        {t("العودة للقائمة", "Back to list")}
      </Link>

      <h1 className="mb-6 font-display text-xl font-bold sm:text-2xl">
        {initial ? t("تعديل مقال", "Edit Article") : t("مقال جديد", "New Article")}
      </h1>

      <form action={action} className="glass-card space-y-4 p-6">
        {initial && <input type="hidden" name="id" value={initial.id} />}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">
              {t("الـ slug", "Slug")} *
            </label>
            <input
              required
              name="slug"
              defaultValue={initial?.slug ?? ""}
              placeholder="getting-started"
              className="glass-input h-10 w-full rounded-lg px-3 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">
              {t("التصنيف", "Category")} *
            </label>
            <select
              required
              name="category"
              defaultValue={initial?.category ?? categories[0]?.slug}
              className="glass-input h-10 w-full rounded-lg px-2 text-sm"
            >
              {categories.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {lang === "ar" ? c.label_ar : (c.label_en ?? c.label_ar)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-muted">
            {t("العنوان بالعربية", "Title (Arabic)")} *
          </label>
          <input
            required
            name="title_ar"
            defaultValue={initial?.title_ar ?? ""}
            className="glass-input h-10 w-full rounded-lg px-3 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">
            {t("العنوان بالإنجليزية", "Title (English)")}
          </label>
          <input
            name="title_en"
            defaultValue={initial?.title_en ?? ""}
            className="glass-input h-10 w-full rounded-lg px-3 text-sm"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-muted">
            {t("المحتوى بالعربية", "Body (Arabic)")} *
          </label>
          <textarea
            required
            name="body_ar"
            defaultValue={initial?.body_ar ?? ""}
            rows={10}
            className="glass-input w-full rounded-lg px-3 py-2 text-sm leading-relaxed"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">
            {t("المحتوى بالإنجليزية", "Body (English)")}
          </label>
          <textarea
            name="body_en"
            defaultValue={initial?.body_en ?? ""}
            rows={10}
            className="glass-input w-full rounded-lg px-3 py-2 text-sm leading-relaxed"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">
              {t("الترتيب", "Sort order")}
            </label>
            <input
              type="number"
              name="sort_order"
              defaultValue={initial?.sort_order ?? 0}
              className="glass-input h-10 w-full rounded-lg px-3 text-sm"
            />
          </div>
          <div className="flex items-end">
            <label className="inline-flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                name="is_published"
                defaultChecked={initial?.is_published ?? false}
                className="h-4 w-4 cursor-pointer accent-[var(--gold)]"
              />
              <span className="text-sm text-foreground">
                {t("منشور", "Published")}
              </span>
            </label>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[var(--surface-divider,#F0F0F2)] pt-4">
          {initial ? (
            <button
              type="button"
              onClick={onDelete}
              disabled={deletePending}
              className="inline-flex items-center gap-1.5 text-sm text-error transition-colors hover:opacity-80 disabled:opacity-50"
            >
              <Trash2 size={14} aria-hidden="true" /> {t("حذف", "Delete")}
            </button>
          ) : <div />}
          <button
            type="submit"
            disabled={pending}
            className="glass-gold glass-pill px-6 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {pending ? t("...", "Saving…") : t("حفظ", "Save")}
          </button>
        </div>
      </form>
    </div>
  );
}
