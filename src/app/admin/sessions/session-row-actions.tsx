"use client";

import { useTransition } from "react";
import { StopCircle, RefreshCw, Eye } from "lucide-react";
import Link from "next/link";
import { forceEndSession, adminRecreateRoom } from "./actions";

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

  function handleForceEnd() {
    const reason = prompt("سبب إنهاء الجلسة:");
    if (!reason) return;
    startTransition(async () => {
      const result = await forceEndSession(sessionId, reason);
      if (result.error) alert(result.error);
    });
  }

  function handleRecreateRoom() {
    if (!confirm("هل أنت متأكد من إعادة إنشاء الغرفة؟")) return;
    startTransition(async () => {
      const result = await adminRecreateRoom(sessionId);
      if (result.error) alert(result.error);
    });
  }

  return (
    <div className="flex items-center gap-1">
      <Link
        href={`/admin/sessions/${sessionId}`}
        className="rounded-lg p-1.5 text-muted transition-colors hover:bg-surface-alt hover:text-foreground"
        title="تفاصيل"
      >
        <Eye size={14} />
      </Link>
      {isActive && (
        <button
          onClick={handleForceEnd}
          disabled={isPending}
          className="rounded-lg p-1.5 text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-50"
          title="إنهاء الجلسة"
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
        >
          <RefreshCw size={14} />
        </button>
      )}
    </div>
  );
}
