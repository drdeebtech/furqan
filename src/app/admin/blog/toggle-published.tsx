"use client";

import { useState } from "react";
import { togglePublished } from "./actions";

export function TogglePublished({ postId, isPublished }: { postId: string; isPublished: boolean }) {
  const [published, setPublished] = useState(isPublished);
  const [loading, setLoading] = useState(false);

  async function handle() {
    setLoading(true);
    await togglePublished(postId, !published);
    setPublished(!published);
    setLoading(false);
  }

  return (
    <button
      onClick={handle}
      disabled={loading}
      className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors disabled:opacity-50 ${
        published
          ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
          : "bg-amber-500/10 text-amber-400 border border-amber-500/30"
      }`}
    >
      {published ? "منشور" : "مسودة"}
    </button>
  );
}
