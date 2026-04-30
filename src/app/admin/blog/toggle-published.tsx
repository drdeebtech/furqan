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
      className={`glass-badge transition-colors disabled:opacity-50 ${
        published
          ? "bg-success/10 text-success border-success/30"
          : "bg-warning/10 text-warning border-warning/30"
      }`}
    >
      {published ? "منشور" : "مسودة"}
    </button>
  );
}
