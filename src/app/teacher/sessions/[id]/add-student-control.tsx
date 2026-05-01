"use client";

import { useState, useTransition } from "react";
import { Plus, X } from "lucide-react";
import { addStudentToSession } from "@/lib/actions/group-session";
import { useLang } from "@/lib/i18n/context";

interface CandidateStudent {
  id: string;
  name: string;
}

/**
 * Client-side control rendered next to the Enrolled Students list on the
 * teacher's session page. Opens a small picker modal listing students this
 * teacher has worked with (passed in from the server). Picking one calls
 * the server action `addStudentToSession`, which handles permissions,
 * idempotency, and credit deduction.
 */
export function AddStudentControl({
  sessionId,
  candidates,
  enrolledIds,
}: {
  sessionId: string;
  candidates: CandidateStudent[];
  enrolledIds: string[];
}) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const enrolledSet = new Set(enrolledIds);
  const eligible = candidates.filter((c) => !enrolledSet.has(c.id));

  function handlePick(studentId: string) {
    setError(null);
    startTransition(async () => {
      const res = await addStudentToSession(sessionId, studentId);
      if (res?.error) {
        setError(res.error);
        return;
      }
      setOpen(false);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen(true); setError(null); }}
        disabled={isPending}
        className="inline-flex items-center gap-1.5 glass glass-gold rounded-lg px-3 py-1.5 text-xs font-medium text-gold transition-colors hover:bg-gold/15 disabled:opacity-50"
      >
        <Plus size={14} aria-hidden="true" />
        {t("أضف طالباً", "Add student")}
      </button>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t("اختر طالباً", "Pick a student")}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="w-full max-w-md rounded-xl border border-[var(--surface-border)] bg-[var(--surface)] p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-bold">
                {t("أضف طالباً للجلسة", "Add a student to this session")}
              </p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t("إغلاق", "Close")}
                className="text-muted hover:text-foreground"
              >
                <X size={16} />
              </button>
            </div>
            {eligible.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">
                {t(
                  "لا يوجد طلاب آخرون متاحون للإضافة الآن.",
                  "No other eligible students to add right now.",
                )}
              </p>
            ) : (
              <ul className="max-h-72 space-y-1 overflow-y-auto">
                {eligible.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => handlePick(c.id)}
                      disabled={isPending}
                      className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors hover:bg-foreground/5 disabled:opacity-50"
                    >
                      <span>{c.name}</span>
                      <span className="text-xs text-gold">
                        {isPending ? "…" : t("إضافة", "Add")}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {error && (
              <p role="alert" className="mt-3 text-xs text-red-400">{error}</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
