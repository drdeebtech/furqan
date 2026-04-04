"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { deleteSlot } from "./actions";

export function DeleteSlotButton({ slotId }: { slotId: string }) {
  const [loading, setLoading] = useState(false);
  const [deleted, setDeleted] = useState(false);

  async function handleDelete() {
    setLoading(true);
    const result = await deleteSlot(slotId);
    if (result.success) {
      setDeleted(true);
    }
    setLoading(false);
  }

  if (deleted) {
    return (
      <span className="text-xs text-muted">تم الحذف</span>
    );
  }

  return (
    <button
      onClick={handleDelete}
      disabled={loading}
      className="rounded-lg border border-card-border p-1.5 text-muted transition-colors hover:border-error/50 hover:text-error disabled:opacity-50"
    >
      {loading ? (
        <span className="block h-4 w-4 animate-spin rounded-full border-2 border-muted/30 border-t-muted" />
      ) : (
        <Trash2 size={16} />
      )}
    </button>
  );
}
