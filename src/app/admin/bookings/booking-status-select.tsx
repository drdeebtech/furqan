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
  const [loading, setLoading] = useState(false);

  return (
    <select
      value={status}
      disabled={loading}
      onChange={async (e) => {
        setLoading(true);
        setStatus(e.target.value);
        await adminUpdateBookingStatus(bookingId, e.target.value);
        setLoading(false);
      }}
      className="rounded border border-card-border bg-surface px-2 py-1 text-xs text-foreground disabled:opacity-50"
    >
      {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
    </select>
  );
}
