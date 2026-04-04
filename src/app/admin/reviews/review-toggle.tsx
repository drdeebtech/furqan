"use client";
import { useState } from "react";
import { toggleReviewPublic } from "./actions";

export function ReviewToggle({ reviewId, isPublic }: { reviewId: string; isPublic: boolean }) {
  const [pub, setPub] = useState(isPublic);
  return (
    <button
      onClick={async () => { setPub(!pub); await toggleReviewPublic(reviewId, !pub); }}
      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${pub ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30" : "bg-red-500/10 text-red-400 border border-red-500/30"}`}
    >
      {pub ? "عام" : "مخفي"}
    </button>
  );
}
