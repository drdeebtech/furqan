"use client";

/**
 * <ActionFeedback /> — drop-in renderer for any server action result that
 * follows the { ok, message?, error? } shape from `loudAction`.
 *
 * Replaces the silent-fail anti-pattern where a form submits, gets back
 * { error: '...' }, and renders nothing. With this component:
 *   - Success → green banner with the message (auto-clears in 4s)
 *   - Error   → red banner with the error (sticky until next action)
 *   - Pristine state → renders nothing
 *
 * Usage:
 *   const [state, formAction, isPending] = useActionState(myAction, null);
 *   return (
 *     <form action={formAction}>
 *       <ActionFeedback state={state} />
 *       ...
 *     </form>
 *   );
 */
import { useEffect, useState, startTransition } from "react";
import { CheckCircle2, AlertCircle } from "lucide-react";
import { useLang } from "@/lib/i18n/context";

type ActionState = { ok: true; message?: string } | { ok: false; error: string } | null | undefined;

export function ActionFeedback({ state }: { state: ActionState }) {
  const { t } = useLang();
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    // startTransition avoids React 19's "cascading renders in effect" warning.
    startTransition(() => setHidden(false));
    if (state?.ok === true) {
      const timer = setTimeout(() => startTransition(() => setHidden(true)), 4000);
      return () => clearTimeout(timer);
    }
  }, [state]);

  if (!state || hidden) return null;

  if (state.ok === true) {
    const msg = state.message ?? t("تم بنجاح", "Done");
    return (
      <div
        role="status"
        className="mb-3 flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-300"
      >
        <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
        <span>{msg}</span>
      </div>
    );
  }

  return (
    <div
      role="alert"
      className="mb-3 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300"
    >
      <AlertCircle size={16} className="mt-0.5 shrink-0" />
      <span>{state.error}</span>
    </div>
  );
}
