"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Mail, ArrowRight } from "lucide-react";
import { forgotPassword, type AuthResult } from "../actions";

export default function ForgotPasswordPage() {
  const [state, formAction, pending] = useActionState<AuthResult, FormData>(
    forgotPassword,
    {},
  );

  return (
    <>
      <h2 className="mb-1 text-xl font-semibold">استعادة كلمة المرور</h2>
      <p className="mb-6 text-sm text-muted">Reset your password</p>

      {state.success && (
        <div className="mb-4 rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success">
          {state.success}
        </div>
      )}

      {state.error && (
        <div className="mb-4 rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error">
          {state.error}
        </div>
      )}

      {!state.success && (
        <form action={formAction} className="space-y-4">
          {/* Email */}
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium">
              البريد الإلكتروني
              <span className="mr-2 text-xs text-muted">Email</span>
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              dir="ltr"
              className="w-full rounded-lg border border-input-border bg-input px-4 py-2.5 text-left text-foreground placeholder:text-muted/50 focus:border-input-focus focus:outline-none focus:ring-1 focus:ring-input-focus"
              placeholder="you@example.com"
            />
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={pending}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-gold py-2.5 font-semibold text-black transition-colors hover:bg-gold-hover disabled:opacity-50"
          >
            {pending ? (
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-black/30 border-t-black" />
            ) : (
              <>
                <Mail size={18} />
                إرسال رابط الاستعادة
              </>
            )}
          </button>
        </form>
      )}

      <p className="mt-6 text-center text-sm text-muted">
        <Link
          href="/login"
          className="inline-flex items-center gap-1 text-gold hover:text-gold-hover"
        >
          <ArrowRight size={14} />
          العودة لتسجيل الدخول
        </Link>
      </p>
    </>
  );
}
