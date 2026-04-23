"use client";

import { useActionState } from "react";
import { RefreshCw } from "lucide-react";
import { runScorerNow } from "./trigger-action";

export function RunScorerButton() {
  const [state, formAction, pending] = useActionState(
    async () => await runScorerNow(),
    null,
  );

  return (
    <form action={formAction} className="flex items-center gap-2">
      <button
        type="submit"
        disabled={pending}
        className="flex items-center gap-2 glass-pill px-3 py-1.5 text-xs font-medium transition-colors hover:bg-gold/10 disabled:opacity-50"
      >
        <RefreshCw size={12} className={pending ? "animate-spin" : ""} />
        {pending ? "جاري الحساب..." : "تشغيل الآن"}
      </button>
      {state?.ok && (
        <span className="text-xs text-emerald-400">
          ✓ تم حساب {state.scored} طالب · {state.high_risk} في خطر
        </span>
      )}
      {state && !state.ok && (
        <span className="text-xs text-red-400" title={state.error}>خطأ</span>
      )}
    </form>
  );
}
