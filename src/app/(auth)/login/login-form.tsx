"use client";

import { useActionState, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff, LogIn } from "lucide-react";
import { login, type AuthResult } from "../actions";
import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";

function oauthErrorMessage(code: string | null): string | null {
  if (!code) return null;
  // TODO(human): map OAuth callback error codes to Arabic messages.
  // The callback at src/app/api/auth/callback/google/route.ts redirects with
  // ?error=<code> on failure. Known codes:
  //   - "oauth_missing_code"     (no `code` param arrived from Google)
  //   - "oauth_exchange_failed"  (Supabase rejected the code-for-session swap)
  //   - "oauth_no_user"          (session created but getUser returned null)
  //   - "oauth_unexpected"       (anything else / thrown error)
  // Return the Arabic string to display, or a generic fallback for unknown codes.
  return null;
}

export function LoginForm() {
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect") ?? "";
  const justRegistered = searchParams.get("registered") === "true";
  const oauthError = oauthErrorMessage(searchParams.get("error"));

  const [showPassword, setShowPassword] = useState(false);
  const [state, formAction, pending] = useActionState<AuthResult, FormData>(
    login,
    {},
  );

  return (
    <>
      <h2 className="font-display mb-1 text-2xl font-bold leading-tight">تسجيل الدخول</h2>
      <p className="mb-6 text-sm text-muted">Sign in to your account</p>

      {justRegistered && (
        <div className="mb-4 rounded-lg glass-success p-3 text-sm text-success">
          تم إنشاء الحساب بنجاح — سجّل دخولك الآن
        </div>
      )}

      {state.error && (
        <div className="mb-4 rounded-lg glass-danger p-3 text-sm text-error">
          {state.error}
        </div>
      )}

      {oauthError && !state.error && (
        <div className="mb-4 rounded-lg glass-danger p-3 text-sm text-error">
          {oauthError}
        </div>
      )}

      <GoogleSignInButton next={redirectTo || undefined} />

      <div className="my-4 flex items-center gap-3">
        <hr className="flex-1 border-t border-white/20" />
        <span className="text-xs text-muted">أو · or</span>
        <hr className="flex-1 border-t border-white/20" />
      </div>

      <form action={formAction} className="space-y-4">
        <input type="hidden" name="redirect" value={redirectTo} />

        {/* Email */}
        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-medium">
            البريد الإلكتروني
            <span className="me-2 text-xs text-muted">Email</span>
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

        {/* Password */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label htmlFor="password" className="text-sm font-medium">
              كلمة المرور
              <span className="me-2 text-xs text-muted">Password</span>
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
              className="w-full rounded-xl glass-input px-4 py-2.5 ps-10 text-left text-foreground placeholder:text-muted/50 focus:border-input-focus focus:outline-none focus:ring-1 focus:ring-input-focus"
              placeholder="••••••••"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted transition-colors hover:text-foreground focus-ring"
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={pending}
          className="flex w-full items-center justify-center gap-2 rounded-full glass-gold glass-pill py-2.5 font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
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
