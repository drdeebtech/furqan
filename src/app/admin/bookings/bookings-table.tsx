"use client";

import { useState, useTransition } from "react";
import { Inbox, Search, CheckCircle, XCircle, UserX } from "lucide-react";
import { SESSION_TYPE_AR } from "@/lib/constants";
import { useLang } from "@/lib/i18n/context";
import type { BookingStatus, SessionType } from "@/types/database";
import { BookingStatusSelect } from "./booking-status-select";
import { bulkUpdateBookingStatus, type BulkBookingResult } from "./bulk-actions";

const SESSION_TYPE_EN: Record<SessionType, string> = {
  hifz: "Hifz",
  muraja: "Review",
  tajweed: "Tajweed",
  tilawa: "Tilawa",
  qiraat: "Qiraat",
  tafsir: "Tafsir",
  combined: "Hifz + Review",
  other: "Other",
};

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

const STATUS_PILLS: { value: StatusFilter; ar: string; en: string }[] = [
  { value: "all", ar: "الكل", en: "All" },
  { value: "pending", ar: "معلق", en: "Pending" },
  { value: "confirmed", ar: "مؤكد", en: "Confirmed" },
  { value: "completed", ar: "مكتمل", en: "Completed" },
  { value: "cancelled", ar: "ملغى", en: "Cancelled" },
  { value: "no_show", ar: "لم يحضر", en: "No-show" },
];

export function BookingsTable({
  bookings,
  nameMap,
}: {
  bookings: BookingRow[];
  nameMap: Record<string, string>;
}) {
  const { t, lang } = useLang();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkResult, setBulkResult] = useState<BulkBookingResult | null>(null);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();

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

  const pendingCount = bookings.filter((b) => b.status === "pending").length;
  const confirmed = bookings.filter((b) => b.status === "confirmed").length;
  const completed = bookings.filter((b) => b.status === "completed").length;

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    setSelected((prev) => (prev.size === filtered.length ? new Set() : new Set(filtered.map((b) => b.id))));
  };
  const runBulk = (status: BookingStatus) => {
    if (selected.size === 0) return;
    start(async () => {
      const r = await bulkUpdateBookingStatus({
        ids: Array.from(selected),
        status,
        reason: reason || undefined,
      });
      setBulkResult(r);
      setSelected(new Set());
      setReason("");
    });
  };

  return (
    <>
      {/* Summary cards */}
      <div className="mb-6 grid grid-cols-4 gap-3">
        {[
          { key: "all", l: t("الكل", "All"), v: bookings.length },
          { key: "pending", l: t("معلق", "Pending"), v: pendingCount },
          { key: "confirmed", l: t("مؤكد", "Confirmed"), v: confirmed },
          { key: "completed", l: t("مكتمل", "Completed"), v: completed },
        ].map((s) => (
          <div
            key={s.key}
            className="glass-card rounded-xl p-3 text-center"
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
            aria-hidden="true"
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("بحث باسم الطالب أو المعلم...", "Search by student or teacher name...")}
            aria-label={t("بحث", "Search")}
            className="w-full rounded-lg border border-card-border bg-surface py-2 pe-9 ps-3 text-sm text-foreground placeholder:text-muted focus:border-gold focus:outline-none sm:w-72"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {STATUS_PILLS.map((pill) => (
            <button
              key={pill.value}
              onClick={() => setStatusFilter(pill.value)}
              className={`glass-pill rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                statusFilter === pill.value
                  ? "glass-gold !text-white"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {lang === "ar" ? pill.ar : pill.en}
            </button>
          ))}
        </div>
      </div>

      {/* Filtered count + batch result */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">
          {lang === "ar"
            ? `عرض ${filtered.length} من ${bookings.length} حجز`
            : `Showing ${filtered.length} of ${bookings.length} bookings`}
        </p>
        {bulkResult && (
          <p className={`text-xs ${bulkResult.failed === 0 ? "text-emerald-400" : "text-amber-400"}`}>
            {lang === "ar"
              ? `تم تحديث ${bulkResult.updated}${bulkResult.failed > 0 ? ` · فشل ${bulkResult.failed}` : ""}`
              : `Updated ${bulkResult.updated}${bulkResult.failed > 0 ? ` · ${bulkResult.failed} failed` : ""}`}
          </p>
        )}
      </div>

      {/* Table or empty state */}
      {filtered.length === 0 ? (
        <div className="glass-card rounded-xl p-12 text-center">
          <Inbox size={32} className="mx-auto mb-3 text-muted" aria-hidden="true" />
          <p className="text-muted">{t("لا توجد حجوزات مطابقة", "No matching bookings")}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl glass-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                <th scope="col" className="w-10 px-3 py-3 text-start">
                  <input
                    type="checkbox"
                    aria-label={t("تحديد الكل", "Select all")}
                    checked={filtered.length > 0 && selected.size === filtered.length}
                    onChange={toggleSelectAll}
                    className="h-4 w-4"
                  />
                </th>
                <th scope="col" className="px-3 py-3 text-start font-medium text-muted">
                  {t("الطالب", "Student")}
                </th>
                <th scope="col" className="px-3 py-3 text-start font-medium text-muted">
                  {t("المعلم", "Teacher")}
                </th>
                <th scope="col" className="px-3 py-3 text-start font-medium text-muted">
                  {t("النوع", "Type")}
                </th>
                <th scope="col" className="px-3 py-3 text-start font-medium text-muted">
                  {t("الموعد", "Date")}
                </th>
                <th scope="col" className="px-3 py-3 text-start font-medium text-muted">
                  {t("المبلغ", "Amount")}
                </th>
                <th scope="col" className="px-3 py-3 text-start font-medium text-muted">
                  {t("الحالة", "Status")}
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b) => (
                <tr
                  key={b.id}
                  className={`border-b border-white/10 last:border-b-0 ${selected.has(b.id) ? "bg-gold/5" : ""}`}
                >
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      aria-label={`\u062a\u062d\u062f\u064a\u062f ${b.id.slice(0, 8)}`}
                      checked={selected.has(b.id)}
                      onChange={() => toggleSelect(b.id)}
                      className="h-4 w-4"
                    />
                  </td>
                  <td className="px-3 py-3">
                    {nameMap[b.student_id] ?? "\u2014"}
                  </td>
                  <td className="px-3 py-3">
                    {nameMap[b.teacher_id] ?? "\u2014"}
                  </td>
                  <td className="px-3 py-3 text-xs text-gold">
                    {lang === "ar" ? SESSION_TYPE_AR[b.session_type] : SESSION_TYPE_EN[b.session_type]}
                  </td>
                  <td className="px-3 py-3 text-xs text-muted">
                    {new Date(b.scheduled_at).toLocaleDateString(lang === "ar" ? "ar" : "en-US")}{" "}
                    {lang === "ar" ? `${b.duration_min}د` : `${b.duration_min}m`}
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

      {selected.size > 0 && (
        <div className="fixed bottom-4 start-1/2 z-40 w-[min(42rem,calc(100%-2rem))] -translate-x-1/2 rounded-2xl border border-gold/40 bg-surface/95 p-3 shadow-xl backdrop-blur rtl:translate-x-1/2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-gold">
              {lang === "ar" ? `تم تحديد ${selected.size}` : `${selected.size} selected`}
            </span>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("السبب (اختياري)", "Reason (optional)")}
              aria-label={t("سبب", "Reason")}
              className="glass-input flex-1 rounded-lg px-3 py-1.5 text-xs"
            />
            <button
              onClick={() => runBulk("confirmed")}
              disabled={pending}
              className="flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
            >
              <CheckCircle size={14} aria-hidden="true" /> {t("تأكيد", "Confirm")}
            </button>
            <button
              onClick={() => runBulk("cancelled")}
              disabled={pending}
              className="flex items-center gap-1 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/20 disabled:opacity-50"
            >
              <XCircle size={14} aria-hidden="true" /> {t("إلغاء", "Cancel")}
            </button>
            <button
              onClick={() => runBulk("no_show")}
              disabled={pending}
              className="flex items-center gap-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/20 disabled:opacity-50"
            >
              <UserX size={14} aria-hidden="true" /> {t("لم يحضر", "No-show")}
            </button>
            <button
              onClick={() => {
                setSelected(new Set());
                setReason("");
              }}
              className="rounded-lg border border-surface-border/60 px-3 py-1.5 text-xs text-muted hover:text-foreground"
            >
              {t("إلغاء التحديد", "Clear selection")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
