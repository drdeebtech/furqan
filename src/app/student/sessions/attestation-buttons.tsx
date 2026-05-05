"use client";

import { useState, useTransition } from "react";
import { Check, X, CheckCheck } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { attestSessionHappened } from "./actions";

/**
 * F10 (resolved 2026-05-05). Two-button attestation surface for the
 * student on a stale-confirmed session. Each click sends a notification
 * to the teacher with the student's claim attached. The session row
 * itself is NOT mutated — the teacher still owns the lifecycle.
 */
export function AttestationButtons({ bookingId }: { bookingId: string }) {
  const { t } = useLang();
  const [pending, startTransition] = useTransition();
  const [verdict, setVerdict] = useState<null | "happened" | "missed" | "error">(null);

  function send(didHappen: boolean) {
    startTransition(async () => {
      const res = await attestSessionHappened(bookingId, didHappen);
      if (res.ok) setVerdict(didHappen ? "happened" : "missed");
      else setVerdict("error");
    });
  }

  if (verdict === "happened") {
    return (
      <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-success">
        <CheckCheck size={12} aria-hidden="true" />
        {t(
          "تم إخطار معلمك أنّ الجلسة تمّت — بانتظار تأكيده.",
          "Your teacher was notified that the session happened — awaiting their confirmation.",
        )}
      </p>
    );
  }

  if (verdict === "missed") {
    return (
      <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted">
        <CheckCheck size={12} aria-hidden="true" />
        {t(
          "تم إخطار معلمك أنّ الجلسة لم تتم — بانتظار رده.",
          "Your teacher was notified that the session didn't happen — awaiting their response.",
        )}
      </p>
    );
  }

  if (verdict === "error") {
    return (
      <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-error">
        {t("تعذّر الإرسال — حاول مجدداً.", "Couldn't send — please try again.")}
      </p>
    );
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted">
        {t("هل تمّت الجلسة؟", "Did the session happen?")}
      </span>
      <button
        type="button"
        onClick={() => send(true)}
        disabled={pending}
        className="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2.5 py-1 text-xs text-success transition-colors hover:bg-success/20 disabled:opacity-50"
      >
        <Check size={12} aria-hidden="true" />
        {t("نعم", "Yes")}
      </button>
      <button
        type="button"
        onClick={() => send(false)}
        disabled={pending}
        className="inline-flex items-center gap-1 rounded-full border border-card-border bg-card/50 px-2.5 py-1 text-xs text-muted transition-colors hover:bg-card disabled:opacity-50"
      >
        <X size={12} aria-hidden="true" />
        {t("لا", "No")}
      </button>
    </div>
  );
}
