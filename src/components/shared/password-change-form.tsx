"use client";

import { useActionState } from "react";
import { KeyRound } from "lucide-react";
import { updatePassword } from "@/lib/actions/account";
import { ActionFeedback } from "@/components/shared/action-feedback";
import type { LoudResult } from "@/lib/actions/loud";

const input =
  "w-full rounded-xl glass-input px-4 py-2.5 text-sm text-foreground focus:border-gold focus:outline-none";

// Self-contained password-change form. Drop into any role's settings page —
// no props needed. Calls the shared `updatePassword` action which derives
// the user from the session, so it never accepts a userId from form input.
export function PasswordChangeForm() {
  const [state, formAction, pending] = useActionState<LoudResult | null, FormData>(
    updatePassword,
    null,
  );

  return (
    <form action={formAction} className="space-y-4">
      <ActionFeedback state={state} />

      <div>
        <label htmlFor="current_password" className="mb-1 block text-sm font-medium">
          كلمة المرور الحالية
          <span className="me-2 text-xs text-muted">Current password</span>
        </label>
        <input
          id="current_password"
          name="current_password"
          type="password"
          required
          autoComplete="current-password"
          dir="ltr"
          className={`${input} text-left`}
        />
      </div>

      <div>
        <label htmlFor="new_password" className="mb-1 block text-sm font-medium">
          كلمة المرور الجديدة
          <span className="me-2 text-xs text-muted">New password (min 8 chars)</span>
        </label>
        <input
          id="new_password"
          name="new_password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          dir="ltr"
          className={`${input} text-left`}
        />
      </div>

      <div>
        <label htmlFor="confirm_password" className="mb-1 block text-sm font-medium">
          تأكيد كلمة المرور
          <span className="me-2 text-xs text-muted">Confirm new password</span>
        </label>
        <input
          id="confirm_password"
          name="confirm_password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          dir="ltr"
          className={`${input} text-left`}
        />
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending}
          className="glass-gold glass-pill flex min-h-[44px] items-center gap-2 px-4 py-2.5 text-sm font-medium hover:bg-gold-hover disabled:opacity-50"
        >
          {pending ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          ) : (
            <KeyRound size={14} aria-hidden="true" />
          )}
          تحديث كلمة المرور
        </button>
      </div>
    </form>
  );
}
