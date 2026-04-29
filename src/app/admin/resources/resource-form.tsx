"use client";

import { useActionState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";
import { ArrowLeft, ArrowRight, Trash2 } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { useToast } from "@/components/shared/toast";
import { saveResource, deleteResource, type ResourceFormState } from "@/lib/actions/resources";

interface ResourceInitial {
  id: string;
  title_ar: string; title_en: string | null;
  description_ar: string | null; description_en: string | null;
  resource_type: string;
  file_url: string | null; external_url: string | null;
  category: string;
  tags: string[];
  is_published: boolean;
}

interface Props {
  initial?: ResourceInitial;
}

const initialState: ResourceFormState = {};

export function ResourceForm({ initial }: Props) {
  const { t, dir } = useLang();
  const router = useRouter();
  const toast = useToast();
  const [state, action, pending] = useActionState(saveResource, initialState);
  const [deletePending, startDelete] = useTransition();

  useEffect(() => {
    if (state.ok) {
      toast.success(t("تم الحفظ", "Saved"));
      if (state.id && !initial) router.push(`/admin/resources/${state.id}/edit`);
    } else if (state.error) {
      toast.error(state.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const onDelete = () => {
    if (!initial) return;
    if (!confirm(t("حذف نهائي؟", "Delete permanently?"))) return;
    startDelete(async () => {
      const res = await deleteResource(initial.id);
      if (res.ok) {
        toast.success(t("تم الحذف", "Deleted"));
        router.push("/admin/resources");
      } else {
        toast.error(res.error ?? t("فشل الحذف", "Delete failed"));
      }
    });
  };

  const Arrow = dir === "rtl" ? ArrowRight : ArrowLeft;

  return (
    <div dir={dir} className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <Link
        href="/admin/resources"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground"
      >
        <Arrow size={14} aria-hidden="true" />
        {t("العودة للقائمة", "Back to list")}
      </Link>

      <h1 className="mb-6 font-display text-xl font-bold sm:text-2xl">
        {initial ? t("تعديل مصدر", "Edit Resource") : t("مصدر جديد", "New Resource")}
      </h1>

      <form action={action} encType="multipart/form-data" className="glass-card space-y-4 p-6">
        {initial && <input type="hidden" name="id" value={initial.id} />}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">{t("النوع", "Type")} *</label>
            <select name="resource_type" defaultValue={initial?.resource_type ?? "pdf"} required className="glass-input h-10 w-full rounded-lg px-2 text-sm">
              <option value="pdf">PDF</option>
              <option value="audio">Audio</option>
              <option value="link">Link</option>
              <option value="video">Video</option>
              <option value="image">Image</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">{t("التصنيف", "Category")}</label>
            <input name="category" defaultValue={initial?.category ?? "general"} className="glass-input h-10 w-full rounded-lg px-3 text-sm" />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-muted">{t("العنوان بالعربية", "Title (Arabic)")} *</label>
          <input required name="title_ar" defaultValue={initial?.title_ar ?? ""} className="glass-input h-10 w-full rounded-lg px-3 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">{t("العنوان بالإنجليزية", "Title (English)")}</label>
          <input name="title_en" defaultValue={initial?.title_en ?? ""} className="glass-input h-10 w-full rounded-lg px-3 text-sm" />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-muted">{t("الوصف بالعربية", "Description (Arabic)")}</label>
          <textarea name="description_ar" defaultValue={initial?.description_ar ?? ""} rows={3} className="glass-input w-full rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">{t("الوصف بالإنجليزية", "Description (English)")}</label>
          <textarea name="description_en" defaultValue={initial?.description_en ?? ""} rows={3} className="glass-input w-full rounded-lg px-3 py-2 text-sm" />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-muted">{t("رابط خارجي", "External URL")}</label>
          <input
            name="external_url"
            type="url"
            defaultValue={initial?.external_url ?? ""}
            placeholder="https://..."
            className="glass-input h-10 w-full rounded-lg px-3 text-sm"
          />
          <p className="mt-1 text-[11px] text-muted-light">
            {t("استخدم الرابط الخارجي أو ارفع ملفًا أدناه — على الأقل واحد منهما.",
               "Use an external URL OR upload a file below — at least one is required.")}
          </p>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-muted">{t("رفع ملف", "Upload file")}</label>
          <input type="file" name="file" className="text-sm" />
          {initial?.file_url && (
            <p className="mt-1 text-[11px] text-muted-light">
              {t("الملف الحالي:", "Current file:")} <a href={initial.file_url} className="text-gold hover:underline" target="_blank" rel="noopener noreferrer">{initial.file_url.split("/").pop()}</a>
            </p>
          )}
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-muted">{t("وسوم (مفصولة بفواصل)", "Tags (comma-separated)")}</label>
          <input
            name="tags"
            defaultValue={initial?.tags.join(", ") ?? ""}
            placeholder="hifz, tajweed, juz-30"
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
            <span className="text-sm text-foreground">{t("منشور", "Published")}</span>
          </label>
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
          <button type="submit" disabled={pending} className="glass-gold glass-pill px-6 py-2 text-sm font-semibold disabled:opacity-50">
            {pending ? t("...", "Saving…") : t("حفظ", "Save")}
          </button>
        </div>
      </form>
    </div>
  );
}
