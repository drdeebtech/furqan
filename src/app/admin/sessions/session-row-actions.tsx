"use client";

import { useState, useTransition } from "react";
import { StopCircle, RefreshCw, Eye, X, Check } from "lucide-react";
import Link from "next/link";
import { forceEndSession, adminRecreateRoom } from "./actions";
import { useToast } from "@/components/shared/toast";

export function SessionRowActions({
  sessionId,
  isActive,
  isExpired,
}: {
  sessionId: string;
  isActive: boolean;
  isExpired: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [showReason, setShowReason] = useState(false);
  const [reason, setReason] = useState("");
  const toast = useToast();

  function handleForceEnd() {
    if (!showReason) {
      setShowReason(true);
      return;
    }
    if (!reason.trim()) return;
    startTransition(async () => {
      const result = await forceEndSession(sessionId, reason.trim());
      if (result.error) toast.error(result.error);
      setShowReason(false);
      setReason("");
    });
  }

  function handleRecreateRoom() {
    startTransition(async () => {
      const result = await adminRecreateRoom(sessionId);
      if (result.error) toast.error(result.error);
    });
  }

  if (showReason) {
    return (
      <div className="flex items-center gap-1">
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleForceEnd()}
          placeholder="السبب..."
          className="w-24 rounded-lg glass-input px-2 py-1 text-xs"
          autoFocus
          aria-label="سبب إنهاء الجلسة"
        />
        <button onClick={handleForceEnd} disabled={isPending || !reason.trim()} className="rounded-lg p-1 text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-50" aria-label="تأكيد">
          <Check size={14} />
        </button>
        <button onClick={() => { setShowReason(false); setReason(""); }} className="rounded-lg p-1 text-muted hover:bg-surface-alt" aria-label="إلغاء">
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <Link
        href={`/admin/sessions/${sessionId}`}
        className="rounded-lg p-1.5 text-muted transition-colors hover:bg-surface-alt hover:text-foreground"
        title="تفاصيل"
        aria-label="عرض"
      >
        <Eye size={14} />
      </Link>
      {isActive && (
        <button
          onClick={handleForceEnd}
          disabled={isPending}
          className="rounded-lg p-1.5 text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-50"
          title="إنهاء الجلسة"
          aria-label="إنهاء الجلسة"
        >
          <StopCircle size={14} />
        </button>
      )}
      {isExpired && (
        <button
          onClick={handleRecreateRoom}
          disabled={isPending}
          className="rounded-lg p-1.5 text-gold transition-colors hover:bg-gold/10 disabled:opacity-50"
          title="إعادة إنشاء الغرفة"
          aria-label="تحديث"
        >
          <RefreshCw size={14} />
        </button>
      )}
    </div>
  );
}
