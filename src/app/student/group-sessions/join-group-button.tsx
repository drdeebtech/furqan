"use client";

import { useState, useTransition } from "react";
import { Users2, CheckCircle, AlertCircle } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { requestJoinGroupSession } from "./actions";

interface Props {
  sessionId: string;
  alreadyEnrolled: boolean;
}

export function JoinGroupButton({ sessionId, alreadyEnrolled }: Props) {
  const { t } = useLang();
  const [pending, startTransition] = useTransition();
  const [requested, setRequested] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (alreadyEnrolled || requested) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-success/30 bg-success/10 px-3 py-1.5 text-xs font-medium text-success">
        <CheckCircle size={12} aria-hidden="true" />
        {requested ? t("في انتظار التأكيد", "Awaiting teacher confirmation") : t("مسجَّل", "Enrolled")}
      </span>
    );
  }

  const handleClick = () => {
    startTransition(async () => {
      setError(null);
      const result = await requestJoinGroupSession(sessionId);
      if (!result.ok) {
        setError(result.error ?? t("فشل التسجيل", "Request failed"));
      } else {
        setRequested(true);
      }
    });
  };

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-full border border-gold/40 bg-gold/15 px-3 py-1.5 text-xs font-semibold text-gold transition-colors hover:bg-gold/20 disabled:opacity-50 focus-ring"
      >
        <Users2 size={12} aria-hidden="true" />
        {pending ? t("جارٍ الإرسال...", "Requesting...") : t("اطلب الانضمام", "Request to join")}
      </button>
      {error && (
        <p className="inline-flex items-center gap-1 text-[11px] text-error">
          <AlertCircle size={10} aria-hidden="true" /> {error}
        </p>
      )}
    </div>
  );
}
