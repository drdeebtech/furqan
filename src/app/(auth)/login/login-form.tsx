"use client";

import { useActionState, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff, LogIn } from "lucide-react";
import { login, type AuthResult } from "../actions";

/**
 * Renders a localized login form with email and password fields, a password visibility toggle, and submission state indicators.
 *
 * Reads `redirect` and `registered` from the URL search params to include a hidden redirect input and optionally show a post-registration notice, displays server error messages returned by the form action, and disables the submit button while submission is pending.
 *
 * @returns The JSX element for the login form.
 */
export function LoginForm() {
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect") ?? "";
  const justRegistered = searchParams.get("registered") === "true";

  const [showPassword, setShowPassword] = useState(false);
  const [state, formAction, pending] = useActionState<AuthResult, FormData>(
    login,
    {},
  );

  return (
    <>
      <h2 className="mb-1 text-xl font-semibold">تسجيل الدخول</h2>
      <p className="mb-6 text-sm text-muted">Sign in to your account</p>

      {justRegistered && (
        <div className="mb-4 rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success">
          تم إنشاء الحساب بنجاح — سجّل دخولك الآن
        </div>
      )}

      {state.error && (
        <div className="mb-4 rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error">
          {state.error}
        </div>
      )}

      <form action={formAction} className="space-y-4">
        <input type="hidden" name="redirect" value={redirectTo} />

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
            className="w-full rounded-xl border border-input-border bg-input neu-inset px-4 py-2.5 text-left text-foreground placeholder:text-muted/50 focus:border-input-focus focus:outline-none focus:ring-1 focus:ring-input-focus"
            placeholder="you@example.com"
          />
        </div>

        {/* Password */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label htmlFor="password" className="text-sm font-medium">
              كلمة المرور
              <span className="mr-2 text-xs text-muted">Password</span>
            </label>
            <Link
              href="/forgot-password"
              className="text-xs text-gold hover:text-gold-hover"
            >
              نسيت كلمة المرور؟
            </Link>
          </div>
          <div className="relative">
            <input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              required
              autoComplete="current-password"
              dir="ltr"
              className="w-full rounded-xl border border-input-border bg-input neu-inset px-4 py-2.5 pe-10 text-left text-foreground placeholder:text-muted/50 focus:border-input-focus focus:outline-none focus:ring-1 focus:ring-input-focus"
              placeholder="••••••••"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
              className="absolute end-3 top-1/2 -translate-y-1/2 text-muted transition-colors hover:text-foreground focus-ring"
              tabIndex={-1}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={pending}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-primary py-2.5 font-semibold text-white neu-btn transition-colors hover:bg-primary-hover disabled:opacity-50"
        >
          {pending ? (
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          ) : (
            <>
              <LogIn size={18} />
              دخول
            </>
          )}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        ليس لديك حساب؟{" "}
        <Link href="/register" className="text-gold hover:text-gold-hover">
          إنشاء حساب جديد
        </Link>
      </p>
    </>
  );
}
