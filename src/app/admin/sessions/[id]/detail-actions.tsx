"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { StopCircle, RefreshCw, Eye, X, Check } from "lucide-react";
import { forceEndSession, adminRecreateRoom } from "../actions";
import { useToast } from "@/components/shared/toast";
import { useLang } from "@/lib/i18n/context";

export function SessionDetailActions({
  sessionId,
  isActive,
  isExpired,
}: {
  sessionId: string;
  isActive: boolean;
  isExpired: boolean;
}) {
  const { t } = useLang();
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

  if (!isActive && !isExpired) return null;

  return (
    <div className="flex flex-wrap gap-3">
      {isActive && (
        <>
          {showReason ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleForceEnd()}
                placeholder={t("سبب إنهاء الجلسة...", "Session end reason...")}
                className="w-48 rounded-xl glass-input px-3 py-2 text-sm"
                autoFocus
                aria-label={t("سبب إنهاء الجلسة", "Session end reason")}
              />
              <button
                onClick={handleForceEnd}
                disabled={isPending || !reason.trim()}
                className="inline-flex items-center gap-1 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-50"
                aria-label={t("تأكيد الإنهاء", "Confirm end")}
              >
                <Check size={14} /> {t("تأكيد", "Confirm")}
              </button>
              <button
                onClick={() => { setShowReason(false); setReason(""); }}
                className="rounded-xl border border-card-border px-3 py-2 text-sm text-muted transition-colors hover:bg-surface-alt"
                aria-label={t("إلغاء", "Cancel")}
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <button
              onClick={handleForceEnd}
              disabled={isPending}
              className="inline-flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-50"
            >
              <StopCircle size={16} />
              {t("إنهاء الجلسة", "End Session")}
            </button>
          )}
          <Link
            href={`/admin/sessions/${sessionId}/observe`}
            className="inline-flex items-center gap-2 rounded-xl border border-gold/30 bg-gold/10 px-4 py-2 text-sm font-medium text-gold transition-colors hover:bg-gold/20"
          >
            <Eye size={16} />
            {t("مراقبة", "Observe")}
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
          {t("إعادة إنشاء الغرفة", "Recreate Room")}
        </button>
      )}
    </div>
  );
}
