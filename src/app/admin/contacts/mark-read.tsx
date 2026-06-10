"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { markAsRead } from "./actions";
import { useToast } from "@/components/shared/toast";

export function MarkReadButton({ submissionId }: { submissionId: string }) {
  const [done, setDone] = useState(false);
  const toast = useToast();

  async function handleClick() {
    const res = await markAsRead(submissionId);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setDone(true);
  }

  if (done) return <span className="text-xs text-green-400">✓ تم</span>;

  return (
    <button
      onClick={handleClick}
      className="flex items-center gap-1 glass glass-pill px-2 py-1 text-xs text-muted hover:text-gold"
    >
      <Check size={12} /> تم القراءة
    </button>
  );
}
