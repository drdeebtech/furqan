"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Pencil, Eye, EyeOff, Trash2 } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { togglePublishTestimonial, deleteTestimonial } from "./actions";

export function TestimonialRowActions({
  id,
  isPublished,
}: {
  id: string;
  isPublished: boolean;
}) {
  const { t } = useLang();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string>("");

  const onToggle = () => {
    start(async () => {
      const r = await togglePublishTestimonial(id, !isPublished);
      setMessage(r.error ?? r.success ?? "");
    });
  };
  const onDelete = () => {
    if (!confirm(t("حذف هذه الشهادة؟", "Delete this testimonial?"))) return;
    start(async () => {
      const r = await deleteTestimonial(id);
      setMessage(r.error ?? r.success ?? "");
    });
  };

  return (
    <div className="flex items-center gap-2">
      <Link
        href={`/admin/testimonials/${id}/edit`}
        className="flex items-center gap-1 rounded-lg border border-surface-border/60 px-2 py-1 text-xs text-muted hover:border-gold/40 hover:text-gold"
      >
        <Pencil size={12} aria-hidden="true" /> {t("تعديل", "Edit")}
      </Link>
      <button
        type="button"
        onClick={onToggle}
        disabled={pending}
        className="flex min-h-[44px] items-center gap-1 rounded-lg border border-surface-border/60 px-2 py-1 text-xs text-muted hover:border-gold/40 hover:text-gold disabled:opacity-50"
      >
        {isPublished ? <EyeOff size={12} aria-hidden="true" /> : <Eye size={12} aria-hidden="true" />}
        {isPublished ? t("إلغاء النشر", "Unpublish") : t("نشر", "Publish")}
      </button>
      <button
        type="button"
        onClick={onDelete}
        disabled={pending}
        className="flex min-h-[44px] items-center gap-1 rounded-lg border border-error/30 bg-error/10 px-2 py-1 text-xs text-red-300 hover:bg-error/20 disabled:opacity-50"
      >
        <Trash2 size={12} aria-hidden="true" /> {t("حذف", "Delete")}
      </button>
      {message && <span className="text-xs text-muted">{message}</span>}
    </div>
  );
}
