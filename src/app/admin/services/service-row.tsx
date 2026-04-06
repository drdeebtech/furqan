"use client";

import { useState } from "react";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { toggleServiceActive, deleteService } from "./actions";

interface Props {
  service: { id: string; title: string; title_ar: string | null; description: string; display_order: number; is_active: boolean; created_at: string };
}

export function ServiceRow({ service }: Props) {
  const [active, setActive] = useState(service.is_active);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className={`rounded-xl border bg-card p-4 ${active ? "border-card-border" : "border-error/20 opacity-60"}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="rounded bg-gold/10 px-2 py-0.5 text-xs text-gold">#{service.display_order}</span>
            <p className="font-medium">{service.title_ar ?? service.title}</p>
          </div>
          <p className="mt-1 text-xs text-muted">{service.title}</p>
          <p className="mt-1 text-xs text-muted">{service.description.length > 100 ? service.description.slice(0, 100) + "…" : service.description}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={async () => { setActive(!active); await toggleServiceActive(service.id, !active); }}
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${active ? "border border-green-500/30 bg-green-500/10 text-green-400" : "border border-red-500/30 bg-red-500/10 text-red-400"}`}
          >
            {active ? "نشط" : "مخفي"}
          </button>
          <Link href={`/admin/services/${service.id}/edit`} className="rounded border border-card-border px-3 py-1 text-xs text-muted hover:text-gold">
            تعديل
          </Link>
          {confirmDelete ? (
            <div className="flex items-center gap-1">
              <button
                onClick={async () => { setDeleting(true); await deleteService(service.id); }}
                disabled={deleting}
                className="rounded bg-error/10 px-2 py-1 text-xs text-error hover:bg-error/20 disabled:opacity-50"
              >
                {deleting ? "..." : "تأكيد"}
              </button>
              <button onClick={() => setConfirmDelete(false)} className="text-xs text-muted">إلغاء</button>
            </div>
          ) : (
            <button onClick={() => setConfirmDelete(true)} className="rounded p-1 text-muted hover:text-error">
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
