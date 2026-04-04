"use client";
import { useState } from "react";
import { toggleReviewPublic } from "./actions";

export function ReviewToggle({ reviewId, isPublic }: { reviewId: string; isPublic: boolean }) {
  const [pub, setPub] = useState(isPublic);
  const [confirmHide, setConfirmHide] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleToggle(newValue: boolean) {
    setLoading(true);
    setPub(newValue);
    await toggleReviewPublic(reviewId, newValue);
    setLoading(false);
    setConfirmHide(false);
  }

  // Confirmation UI for hiding a public review (destructive direction)
  if (confirmHide) {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-xs text-amber-400">إخفاء هذا التقييم؟</p>
        <div className="flex gap-2">
          <button
            onClick={() => handleToggle(false)}
            disabled={loading}
            className="rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
          >
            {loading ? "..." : "تأكيد"}
          </button>
          <button
            onClick={() => setConfirmHide(false)}
            disabled={loading}
            className="text-xs text-muted transition-colors hover:text-foreground"
          >
            إلغاء
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={() => {
        if (pub) {
          // Hiding a public review is destructive — require confirmation
          setConfirmHide(true);
        } else {
          // Making hidden → public is non-destructive — fire instantly
          handleToggle(true);
        }
      }}
      disabled={loading}
      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${pub ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30" : "bg-red-500/10 text-red-400 border border-red-500/30"}`}
    >
      {loading ? "..." : pub ? "عام" : "مخفي"}
    </button>
  );
}
