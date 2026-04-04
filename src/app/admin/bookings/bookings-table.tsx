"use client";

import { useState } from "react";
import { Inbox, Search } from "lucide-react";
import { SESSION_TYPE_AR } from "@/lib/constants";
import type { BookingStatus, SessionType } from "@/types/database";
import { BookingStatusSelect } from "./booking-status-select";

interface BookingRow {
  id: string;
  student_id: string;
  teacher_id: string;
  scheduled_at: string;
  duration_min: number;
  status: BookingStatus;
  session_type: SessionType;
  amount_usd: number;
  created_at: string;
}

type StatusFilter = "all" | BookingStatus;

const STATUS_PILLS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "الكل" },
  { value: "pending", label: "معلق" },
  { value: "confirmed", label: "مؤكد" },
  { value: "completed", label: "مكتمل" },
  { value: "cancelled", label: "ملغى" },
  { value: "no_show", label: "لم يحضر" },
];

export function BookingsTable({
  bookings,
  nameMap,
}: {
  bookings: BookingRow[];
  nameMap: Record<string, string>;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const filtered = bookings.filter((b) => {
    if (statusFilter !== "all" && b.status !== statusFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      const studentName = (nameMap[b.student_id] ?? "").toLowerCase();
      const teacherName = (nameMap[b.teacher_id] ?? "").toLowerCase();
      if (!studentName.includes(q) && !teacherName.includes(q)) return false;
    }
    return true;
  });

  const pending = bookings.filter((b) => b.status === "pending").length;
  const confirmed = bookings.filter((b) => b.status === "confirmed").length;
  const completed = bookings.filter((b) => b.status === "completed").length;

  return (
    <>
      {/* Summary cards */}
      <div className="mb-6 grid grid-cols-4 gap-3">
        {[
          { l: "الكل", v: bookings.length },
          { l: "معلق", v: pending },
          { l: "مؤكد", v: confirmed },
          { l: "مكتمل", v: completed },
        ].map((s) => (
          <div
            key={s.l}
            className="rounded-xl border border-card-border bg-card p-3 text-center"
          >
            <p className="text-xl font-bold text-gold">{s.v}</p>
            <p className="text-xs text-muted">{s.l}</p>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative">
          <Search
            size={16}
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="بحث باسم الطالب أو المعلم..."
            className="w-full rounded-lg border border-card-border bg-surface py-2 pr-9 pl-3 text-sm text-foreground placeholder:text-muted focus:border-gold focus:outline-none sm:w-72"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {STATUS_PILLS.map((pill) => (
            <button
              key={pill.value}
              onClick={() => setStatusFilter(pill.value)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                statusFilter === pill.value
                  ? "bg-gold/20 text-gold"
                  : "bg-card text-muted hover:bg-card-border hover:text-foreground"
              }`}
            >
              {pill.label}
            </button>
          ))}
        </div>
      </div>

      {/* Filtered count */}
      <p className="mb-3 text-xs text-muted">
        عرض {filtered.length} من {bookings.length} حجز
      </p>

      {/* Table or empty state */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-card-border bg-card p-12 text-center">
          <Inbox size={32} className="mx-auto mb-3 text-muted" />
          <p className="text-muted">لا توجد حجوزات مطابقة</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-card-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-card-border bg-card">
                <th className="px-3 py-3 text-right font-medium text-muted">
                  الطالب
                </th>
                <th className="px-3 py-3 text-right font-medium text-muted">
                  المعلم
                </th>
                <th className="px-3 py-3 text-right font-medium text-muted">
                  النوع
                </th>
                <th className="px-3 py-3 text-right font-medium text-muted">
                  الموعد
                </th>
                <th className="px-3 py-3 text-right font-medium text-muted">
                  المبلغ
                </th>
                <th className="px-3 py-3 text-right font-medium text-muted">
                  الحالة
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b) => (
                <tr
                  key={b.id}
                  className="border-b border-card-border last:border-b-0"
                >
                  <td className="px-3 py-3">
                    {nameMap[b.student_id] ?? "\u2014"}
                  </td>
                  <td className="px-3 py-3">
                    {nameMap[b.teacher_id] ?? "\u2014"}
                  </td>
                  <td className="px-3 py-3 text-xs text-gold">
                    {SESSION_TYPE_AR[b.session_type]}
                  </td>
                  <td className="px-3 py-3 text-xs text-muted">
                    {new Date(b.scheduled_at).toLocaleDateString("ar-SA")}{" "}
                    {b.duration_min}د
                  </td>
                  <td className="px-3 py-3 text-gold">${b.amount_usd}</td>
                  <td className="px-3 py-3">
                    <BookingStatusSelect
                      bookingId={b.id}
                      currentStatus={b.status}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
