"use client";

import { useTransition } from "react";
import Link from "next/link";
import { StopCircle, RefreshCw, Eye } from "lucide-react";
import { forceEndSession, adminRecreateRoom } from "../actions";

export function SessionDetailActions({
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

  if (!isActive && !isExpired) return null;

  return (
    <div className="flex flex-wrap gap-3">
      {isActive && (
        <>
          <button
            onClick={handleForceEnd}
            disabled={isPending}
            className="inline-flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-50"
          >
            <StopCircle size={16} />
            إنهاء الجلسة
          </button>
          <Link
            href={`/admin/sessions/${sessionId}/observe`}
            className="inline-flex items-center gap-2 rounded-xl border border-gold/30 bg-gold/10 px-4 py-2 text-sm font-medium text-gold transition-colors hover:bg-gold/20"
          >
            <Eye size={16} />
            مراقبة
          </Link>
        </>
      )}
      {isExpired && (
        <button
          onClick={handleRecreateRoom}
          disabled={isPending}
          className="inline-flex items-center gap-2 rounded-xl border border-gold/30 bg-gold/10 px-4 py-2 text-sm font-medium text-gold transition-colors hover:bg-gold/20 disabled:opacity-50"
        >
          <RefreshCw size={16} />
          إعادة إنشاء الغرفة
        </button>
      )}
    </div>
  );
}
