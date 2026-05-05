"use client";

import { useState } from "react";
import { Plus, X, ChevronLeft } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { HomeworkAssignmentForm } from "@/components/shared/homework-assignment-form";

export interface DialogBooking {
  bookingId: string;
  studentId: string;
  studentName: string;
}

interface Props {
  bookings: DialogBooking[];
}

export function AddFollowUpDialog({ bookings }: Props) {
  const { t, dir } = useLang();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<DialogBooking | null>(null);

  const close = () => {
    setOpen(false);
    setPicked(null);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={bookings.length === 0}
        className="glass-gold glass-pill flex items-center gap-2 px-4 py-2 text-sm font-semibold transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50 focus-ring"
        aria-label={t("إضافة متابعة جديدة", "Add new follow-up")}
      >
        <Plus size={16} />
        {t("إضافة متابعة", "Add follow-up")}
      </button>

      {bookings.length === 0 && (
        <p className="w-full text-xs text-muted-light sm:w-auto">
          {t(
            "لا توجد حجوزات مؤكدة — أكّد حجزاً أولاً",
            "No confirmed bookings yet — confirm a booking first",
          )}
        </p>
      )}

      {open && (
        <div
          dir={dir}
          role="dialog"
          aria-modal="true"
          aria-label={t("إضافة متابعة", "Add follow-up")}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div className="glass-card relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl sm:rounded-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--surface-border)] bg-[var(--surface)] px-5 py-3">
              <div className="flex items-center gap-2">
                {picked && (
                  <button
                    type="button"
                    onClick={() => setPicked(null)}
                    className="rounded-lg p-1 text-muted transition-colors hover:text-foreground focus-ring"
                    aria-label={t("رجوع", "Back")}
                  >
                    <ChevronLeft size={18} />
                  </button>
                )}
                <h2 className="text-base font-semibold">
                  {picked
                    ? t(`متابعة لـ ${picked.studentName}`, `Follow-up for ${picked.studentName}`)
                    : t("اختر الطالب", "Pick the student")}
                </h2>
              </div>
              <button
                type="button"
                onClick={close}
                className="rounded-lg p-1 text-muted transition-colors hover:text-foreground focus-ring"
                aria-label={t("إغلاق", "Close")}
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5">
              {!picked ? (
                <ul className="space-y-2">
                  {bookings.map((b) => (
                    <li key={b.bookingId}>
                      <button
                        type="button"
                        onClick={() => setPicked(b)}
                        className="glass-card flex w-full items-center justify-between rounded-xl p-3 text-start transition-colors hover:bg-foreground/5 focus-ring"
                      >
                        <span className="text-sm font-medium">{b.studentName}</span>
                        <span className="text-xs text-muted-light">
                          {t("اختر", "Choose →")}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <HomeworkAssignmentForm
                  bookingId={picked.bookingId}
                  studentId={picked.studentId}
                  sessionId={null}
                  hideHeader
                  defaultOpen
                />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
