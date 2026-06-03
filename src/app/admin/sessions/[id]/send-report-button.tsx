"use client";

import { useActionState } from "react";
import { Mail } from "lucide-react";
import { sendSessionNarrative } from "@/lib/reports/send-narrative";
import { ActionFeedback } from "@/components/shared/action-feedback";

interface Props {
  sessionId: string;
  actorId: string;
}

export function SendReportButton({ sessionId, actorId }: Props) {
  const [state, formAction, pending] = useActionState(
    async () => await sendSessionNarrative({ sessionId, actorId }),
    null,
  );

  return (
    <form action={formAction} className="inline-flex flex-col gap-2">
      <button
        type="submit"
        disabled={pending || state?.ok === true}
        className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
          state?.ok
            ? "border-success/30 bg-success/10 text-success"
            : "border-gold/30 bg-gold/10 text-gold hover:bg-gold/20"
        }`}
      >
        <Mail size={16} />
        {pending
          ? "جاري الإرسال..."
          : state?.already_sent
            ? "✓ أُرسل مسبقًا"
            : state?.ok
              ? "✓ أُرسل لولي الأمر"
              : "إرسال تقرير للوالد"}
      </button>
      <ActionFeedback state={state} />
    </form>
  );
}
