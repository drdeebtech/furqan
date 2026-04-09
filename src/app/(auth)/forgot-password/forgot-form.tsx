"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Mail, ArrowRight } from "lucide-react";
import { forgotPassword, type AuthResult } from "../actions";

export function ForgotForm() {
  const [state, formAction, pending] = useActionState<AuthResult, FormData>(
    forgotPassword,
    {},
  );

  return (
    <>
      <h2 className="font-display mb-1 text-2xl font-bold leading-tight">استعادة كلمة المرور</h2>
      <p className="mb-6 text-sm text-muted">Reset your password</p>

      {state.success && (
        <div className="mb-4 rounded-lg glass-success p-3 text-sm text-success">
          {state.success}
        </div>
      )}

      {state.error && (
        <div className="mb-4 rounded-lg glass-danger p-3 text-sm text-error">
          {state.error}
        </div>
      )}

      {!state.success && (
        <form action={formAction} className="space-y-4">
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
              className="w-full rounded-xl glass-input px-4 py-2.5 text-left text-foreground placeholder:text-muted/50 focus:border-input-focus focus:outline-none focus:ring-1 focus:ring-input-focus"
              placeholder="you@example.com"
            />
          </div>

          <button
            type="submit"
            disabled={pending}
            className="flex w-full items-center justify-center gap-2 rounded-full glass-gold glass-pill py-2.5 font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
          >
            {pending ? (
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
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
