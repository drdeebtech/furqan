"use client";

import { useState } from "react";
import { Check, X, ExternalLink } from "lucide-react";
import { updateBookingStatus } from "./actions";
import { useToast } from "@/components/shared/toast";

export function BookingActions({ bookingId, isFirst }: { bookingId: string; isFirst?: boolean }) {
  const [loading, setLoading] = useState<"confirm" | "decline" | null>(null);
  const [done, setDone] = useState<"confirmed" | "cancelled" | null>(null);
  const [roomUrl, setRoomUrl] = useState<string | null>(null);
  const [confirmDecline, setConfirmDecline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  async function handle(status: "confirmed" | "cancelled") {
    setLoading(status === "confirmed" ? "confirm" : "decline");
    setError(null);

    const result = await updateBookingStatus(bookingId, status);

    if (result.error) {
      setError(result.error);
      toast.error(result.error);
      setLoading(null);
    } else {
      setDone(status);
      if (result.roomUrl) setRoomUrl(result.roomUrl);
      if (result.warning) { setError(result.warning); toast.warning(result.warning); }
      else { toast.success(status === "confirmed" ? "تم تأكيد الحجز بنجاح" : "تم رفض الحجز"); }
      setLoading(null);
    }
  }

  if (done === "confirmed") {
    return (
      <div className="flex flex-col items-end gap-1">
        <span className="glass-success glass-badge rounded-full px-3 py-1 text-xs text-emerald-400">
          تم التأكيد
        </span>
        {roomUrl && (
          <a
            href={roomUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-gold hover:text-gold-hover"
          >
            رابط الجلسة
            <ExternalLink size={12} />
          </a>
        )}
        {error && (
          <p className="mt-1 text-xs text-amber-400">{error}</p>
        )}
      </div>
    );
  }

  if (done === "cancelled") {
    return (
      <span className="glass-danger glass-badge rounded-full px-3 py-1 text-xs text-red-400">
        تم الرفض
      </span>
    );
  }

  // Inline confirmation for decline
  if (confirmDecline) {
    return (
      <div className="flex flex-col items-end gap-2">
        <p className="text-xs text-error">هل أنت متأكد من رفض هذا الحجز؟</p>
        <div className="flex gap-2">
          <button
            onClick={() => handle("cancelled")}
            disabled={loading !== null}
            className="glass-danger glass-pill px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
          >
            {loading === "decline" ? (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : (
              "نعم، ارفض"
            )}
          </button>
          <button
            onClick={() => setConfirmDecline(false)}
            disabled={loading !== null}
            className="glass glass-pill px-3 py-1.5 text-xs text-muted transition-colors hover:text-foreground disabled:opacity-50"
          >
            إلغاء
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {error && <p className="text-xs text-error">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={() => handle("confirmed")}
          disabled={loading !== null}
          className={`glass-success glass-pill flex min-h-[44px] items-center gap-1 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-50 sm:px-3 sm:py-1.5 ${isFirst ? "animate-pulse-slow ring-2 ring-green-400/50" : ""}`}
        >
          {loading === "confirm" ? (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          ) : (
            <Check size={14} />
          )}
          تأكيد
        </button>
        <button
          onClick={() => setConfirmDecline(true)}
          disabled={loading !== null}
          className="flex min-h-[44px] items-center gap-1 rounded-lg border border-red-500/30 px-4 py-2 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-50 sm:px-3 sm:py-1.5"
        >
          <X size={14} />
          رفض
        </button>
      </div>
    </div>
  );
}
