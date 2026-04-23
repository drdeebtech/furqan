"use client";

import { useActionState } from "react";
import { Mail } from "lucide-react";
import { sendSessionNarrative } from "@/lib/reports/send-narrative";

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
    <form action={formAction} className="inline-flex">
      <button
        type="submit"
        disabled={pending || state?.ok === true}
        className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
          state?.ok
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
            : "border-gold/30 bg-gold/10 text-gold hover:bg-gold/20"
        }`}
        title={state?.error}
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
    </form>
  );
}
