"use client";

import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

export function RefreshButton({ ar, en }: { ar: string; en: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.refresh()}
      className="inline-flex items-center gap-2 rounded-md border border-line bg-surface-2 px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-surface-3"
    >
      <RefreshCw className="size-3.5" aria-hidden />
      <span lang="ar" dir="rtl">{ar}</span>
      <span className="text-muted">·</span>
      <span lang="en">{en}</span>
    </button>
  );
}
