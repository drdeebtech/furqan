"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { deletePost } from "./actions";

export function DeletePostButton({ postId }: { postId: string }) {
  const [confirm, setConfirm] = useState(false);
  const [loading, setLoading] = useState(false);

  if (confirm) {
    return (
      <div className="flex items-center gap-1">
        <button
          onClick={async () => { setLoading(true); await deletePost(postId); }}
          disabled={loading}
          className="text-xs text-error hover:underline disabled:opacity-50"
        >
          {loading ? "..." : "تأكيد"}
        </button>
        <button onClick={() => setConfirm(false)} className="text-xs text-muted">إلغاء</button>
      </div>
    );
  }

  return (
    <button onClick={() => setConfirm(true)} className="flex items-center gap-1 text-xs text-error/60 transition-colors hover:text-error">
      <Trash2 size={12} /> حذف
    </button>
  );
}
