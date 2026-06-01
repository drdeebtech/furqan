"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { deletePost } from "./actions";
import { useToast } from "@/components/shared/toast";

export function DeletePostButton({ postId }: { postId: string }) {
  const [confirm, setConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  if (confirm) {
    return (
      <div className="flex items-center gap-1">
        <button
          onClick={async () => {
            setLoading(true);
            const res = await deletePost(postId);
            if (res?.error) {
              toast.error(res.error);
              setLoading(false);
              setConfirm(false);
            }
          }}
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
