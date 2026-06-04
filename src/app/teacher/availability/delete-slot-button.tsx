"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { deleteSlot } from "./actions";

export function DeleteSlotButton({ slotId }: { slotId: string }) {
  const { t } = useLang();
  const [loading, setLoading] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setLoading(true);
    setError(null);
    const result = await deleteSlot(slotId);
    if (result.ok) {
      setDeleted(true);
    } else {
      setError(result.error);
    }
    setLoading(false);
  }

  if (deleted) {
    return (
      <span className="text-xs text-muted">{t("تم الحذف", "Deleted")}</span>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {error && (
        <span className="text-xs text-error" title={error}>{t("فشل الحذف", "Delete failed")}</span>
      )}
      <button
        onClick={handleDelete}
        disabled={loading}
        aria-label={t("حذف هذا الموعد", "Delete this slot")}
        className="glass rounded-lg p-1.5 text-muted transition-colors hover:border-error/50 hover:text-error disabled:opacity-50 focus-ring"
      >
        {loading ? (
          <span className="block h-4 w-4 animate-spin rounded-full border-2 border-muted/30 border-t-muted" />
        ) : (
          <Trash2 size={16} />
        )}
      </button>
    </div>
  );
}
