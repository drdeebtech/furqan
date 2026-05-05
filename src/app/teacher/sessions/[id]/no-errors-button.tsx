"use client";

import { useState, useTransition } from "react";
import { Check, Loader2 } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { markNoErrorsObserved } from "./actions";

/**
 * Sprint 2.2 (2026-05-05) — "no errors observed" button.
 *
 * Surfaces only when the per-session error count is 0. Lets the teacher
 * make an active assertion ("I observed the recitation and there were
 * no tajweed errors") instead of silently leaving the session
 * unevaluated. The server inserts a sentinel recitation_errors row so
 * the count flips to 1 and the parent banner switches green on the
 * next render.
 */
export function NoErrorsButton({
  sessionId,
  bookingId,
}: {
  sessionId: string;
  bookingId: string;
}) {
  const { t } = useLang();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onClick = () => {
    setError(null);
    startTransition(async () => {
      const result = await markNoErrorsObserved(sessionId, bookingId);
      if ("error" in result && result.error) {
        setError(result.error);
      }
    });
  };

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={onClick}
        disabled={isPending}
        className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-warning/40 bg-warning/15 px-3 py-2 text-xs font-medium text-warning transition-colors hover:bg-warning/25 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? (
          <Loader2 size={14} className="animate-spin" aria-hidden="true" />
        ) : (
          <Check size={14} aria-hidden="true" />
        )}
        {t("علّم: لم ألاحظ أخطاء", "Mark: no errors observed")}
      </button>
      {error && (
        <p className="mt-1.5 text-xs text-danger">{error}</p>
      )}
    </div>
  );
}
