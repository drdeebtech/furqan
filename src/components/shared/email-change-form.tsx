"use client";

import { useActionState } from "react";
import { Mail } from "lucide-react";
import { updateEmail } from "@/lib/actions/account";
import { ActionFeedback } from "@/components/shared/action-feedback";
import type { LoudResult } from "@/lib/actions/loud";

const input =
  "w-full rounded-xl glass-input px-4 py-2.5 text-sm text-foreground focus:border-gold focus:outline-none";

// Drop-in email-change form. Caller passes the user's current email so we
// can show it as context. The action verifies the current password before
// triggering Supabase's change-email flow; Supabase emails the confirmation
// link to both addresses and the change doesn't apply until the user clicks.
export function EmailChangeForm({ currentEmail }: { currentEmail: string }) {
  const [state, formAction, pending] = useActionState<LoudResult | null, FormData>(
    updateEmail,
    null,
  );

  return (
    <form action={formAction} className="space-y-4">
      <ActionFeedback state={state} />

      <p className="text-xs text-muted">
        البريد الحالي: <span className="text-foreground" dir="ltr">{currentEmail}</span>
      </p>

      <div>
        <label htmlFor="new_email" className="mb-1 block text-sm font-medium">
          البريد الإلكتروني الجديد
          <span className="me-2 text-xs text-muted">New email</span>
        </label>
        <input
          id="new_email"
          name="new_email"
          type="email"
          required
          autoComplete="email"
          dir="ltr"
          className={`${input} text-left`}
        />
      </div>

      <div>
        <label htmlFor="email_current_password" className="mb-1 block text-sm font-medium">
          كلمة المرور الحالية
          <span className="me-2 text-xs text-muted">Current password (to confirm)</span>
        </label>
        <input
          id="email_current_password"
          name="current_password"
          type="password"
          required
          autoComplete="current-password"
          dir="ltr"
          className={`${input} text-left`}
        />
      </div>

      <p className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-400">
        سنرسل رابط تأكيد إلى البريد الجديد. لن يتغير بريدك حتى تضغط على الرابط.
      </p>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending}
          className="glass-gold glass-pill flex min-h-[44px] items-center gap-2 px-4 py-2.5 text-sm font-medium hover:bg-gold-hover disabled:opacity-50"
        >
          {pending ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          ) : (
            <Mail size={14} aria-hidden="true" />
          )}
          تغيير البريد
        </button>
      </div>
    </form>
  );
}
