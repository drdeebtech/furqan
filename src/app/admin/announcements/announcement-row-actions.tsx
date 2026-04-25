"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Pencil, PowerOff, Trash2 } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { deactivateAnnouncement, deleteAnnouncement } from "./actions";

export function AnnouncementRowActions({
  id,
  canDeactivate,
}: {
  id: string;
  canDeactivate: boolean;
}) {
  const { t } = useLang();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string>("");

  const onDeactivate = () => {
    start(async () => {
      const r = await deactivateAnnouncement(id);
      setMessage(r.error ?? r.success ?? "");
    });
  };
  const onDelete = () => {
    if (!confirm(t("حذف هذا التنبيه؟", "Delete this announcement?"))) return;
    start(async () => {
      const r = await deleteAnnouncement(id);
      setMessage(r.error ?? r.success ?? "");
    });
  };

  return (
    <div className="flex items-center gap-2">
      <Link
        href={`/admin/announcements/${id}/edit`}
        className="flex items-center gap-1 rounded-lg border border-surface-border/60 px-2 py-1 text-xs text-muted hover:border-gold/40 hover:text-gold"
      >
        <Pencil size={12} aria-hidden="true" /> {t("تعديل", "Edit")}
      </Link>
      {canDeactivate && (
        <button
          onClick={onDeactivate}
          disabled={pending}
          className="flex items-center gap-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-300 hover:bg-amber-500/20 disabled:opacity-50"
        >
          <PowerOff size={12} aria-hidden="true" /> {t("إيقاف", "Deactivate")}
        </button>
      )}
      <button
        onClick={onDelete}
        disabled={pending}
        className="flex items-center gap-1 rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-300 hover:bg-red-500/20 disabled:opacity-50"
      >
        <Trash2 size={12} aria-hidden="true" /> {t("حذف", "Delete")}
      </button>
      {message && <span className="text-xs text-muted">{message}</span>}
    </div>
  );
}
