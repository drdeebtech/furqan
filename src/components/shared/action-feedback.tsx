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
import { useEffect, useMemo, useState, startTransition } from "react";
import { CheckCircle2, AlertCircle } from "lucide-react";
import { useLang } from "@/lib/i18n/context";

// Modern shape from loudAction. Preferred for new server actions.
type LoudShape =
  | { ok: true; message?: string }
  | { ok: false; error: string };

// Legacy shape used widely across admin forms. We accept it so adoption is
// possible without rewriting every server action — server-side migration
// can happen incrementally.
type LegacyShape = { success?: boolean | string; error?: string | null; message?: string };

type ActionState = LoudShape | LegacyShape | null | undefined;

function normalize(state: ActionState): { ok: true; message?: string } | { ok: false; error: string } | null {
  if (!state) return null;
  if ("ok" in state) return state;
  if (state.error) return { ok: false, error: state.error };
  if (state.success) {
    const msg = typeof state.success === "string" ? state.success : state.message;
    return { ok: true, message: msg };
  }
  return null;
}

export function ActionFeedback({ state }: { state: ActionState }) {
  const { t } = useLang();
  const [hidden, setHidden] = useState(false);
  const normalized = useMemo(() => normalize(state), [state]);

  useEffect(() => {
    // startTransition avoids React 19's "cascading renders in effect" warning.
    startTransition(() => setHidden(false));
    if (normalized?.ok === true) {
      const timer = setTimeout(() => startTransition(() => setHidden(true)), 4000);
      return () => clearTimeout(timer);
    }
  }, [normalized]);

  if (!normalized || hidden) return null;

  if (normalized.ok === true) {
    const msg = normalized.message ?? t("تم بنجاح", "Done");
    return (
      <div
        role="status"
        className="mb-3 flex items-start gap-2 rounded-xl border border-success/30 bg-success/10 p-3 text-sm text-success"
      >
        <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
        <span>{msg}</span>
      </div>
    );
  }

  return (
    <div
      role="alert"
      className="mb-3 flex items-start gap-2 rounded-xl border border-error/30 bg-error/10 p-3 text-sm text-red-300"
    >
      <AlertCircle size={16} className="mt-0.5 shrink-0" />
      <span>{normalized.error}</span>
    </div>
  );
}
