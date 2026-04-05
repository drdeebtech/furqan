"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { deleteReview } from "./actions";

export function DeleteReviewButton({ reviewId }: { reviewId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    setLoading(true);
    await deleteReview(reviewId);
    setLoading(false);
    setConfirming(false);
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={handleDelete}
          disabled={loading}
          className="rounded border border-error/30 bg-error/10 px-2 py-1 text-xs text-error hover:bg-error/20 disabled:opacity-50"
        >
          {loading ? "..." : "تأكيد الحذف"}
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="text-xs text-muted hover:text-foreground"
        >
          إلغاء
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="rounded p-1 text-muted transition-colors hover:text-error"
      title="حذف المراجعة"
    >
      <Trash2 size={14} />
    </button>
  );
}
