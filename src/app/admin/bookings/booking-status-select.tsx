"use client";
import { useState } from "react";
import { adminUpdateBookingStatus } from "./actions";

const STATUSES = [
  { value: "pending", label: "معلق" },
  { value: "confirmed", label: "مؤكد" },
  { value: "completed", label: "مكتمل" },
  { value: "cancelled", label: "ملغى" },
  { value: "no_show", label: "لم يحضر" },
];

export function BookingStatusSelect({ bookingId, currentStatus }: { bookingId: string; currentStatus: string }) {
  const [status, setStatus] = useState(currentStatus);
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function confirmStatusChange() {
    if (!pendingStatus) return;
    setLoading(true);
    setStatus(pendingStatus);
    await adminUpdateBookingStatus(bookingId, pendingStatus);
    setLoading(false);
    setPendingStatus(null);
  }

  if (pendingStatus) {
    const pendingLabel = STATUSES.find(s => s.value === pendingStatus)?.label ?? pendingStatus;
    return (
      <div className="flex flex-col gap-1">
        <p className="text-xs text-amber-400">تأكيد؟ ({pendingLabel})</p>
        <div className="flex gap-2">
          <button
            onClick={confirmStatusChange}
            disabled={loading}
            className="rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
          >
            {loading ? "..." : "تأكيد"}
          </button>
          <button
            onClick={() => setPendingStatus(null)}
            disabled={loading}
            className="text-xs text-muted transition-colors hover:text-foreground"
          >
            إلغاء
          </button>
        </div>
      </div>
    );
  }

  return (
    <select
      value={status}
      disabled={loading}
      onChange={(e) => {
        if (e.target.value !== status) {
          setPendingStatus(e.target.value);
        }
      }}
      className="rounded border border-card-border bg-surface px-2 py-1 text-xs text-foreground disabled:opacity-50"
    >
      {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
    </select>
  );
}
