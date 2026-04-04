"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";
import { updateBookingStatus } from "./actions";

export function BookingActions({ bookingId }: { bookingId: string }) {
  const [loading, setLoading] = useState<"confirm" | "decline" | null>(null);
  const [done, setDone] = useState<"confirmed" | "cancelled" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handle(status: "confirmed" | "cancelled") {
    setLoading(status === "confirmed" ? "confirm" : "decline");
    setError(null);

    const result = await updateBookingStatus(bookingId, status);

    if (result.error) {
      setError(result.error);
      setLoading(null);
    } else {
      setDone(status);
      setLoading(null);
    }
  }

  if (done === "confirmed") {
    return (
      <span className="rounded-full border border-green-500/30 bg-green-500/10 px-3 py-1 text-xs text-green-400">
        تم التأكيد
      </span>
    );
  }

  if (done === "cancelled") {
    return (
      <span className="rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-xs text-red-400">
        تم الرفض
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {error && <p className="text-xs text-error">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={() => handle("confirmed")}
          disabled={loading !== null}
          className="flex items-center gap-1 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-50"
        >
          {loading === "confirm" ? (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          ) : (
            <Check size={14} />
          )}
          تأكيد
        </button>
        <button
          onClick={() => handle("cancelled")}
          disabled={loading !== null}
          className="flex items-center gap-1 rounded-lg border border-red-500/30 px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-50"
        >
          {loading === "decline" ? (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-red-400/30 border-t-red-400" />
          ) : (
            <X size={14} />
          )}
          رفض
        </button>
      </div>
    </div>
  );
}
