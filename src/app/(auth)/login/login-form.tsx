"use client";

import { useActionState, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff, LogIn } from "lucide-react";
import { login } from "../actions";
import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";
import { ActionFeedback } from "@/components/shared/action-feedback";

function oauthErrorMessage(code: string | null): string | null {
  if (!code) return null;
  // The callback at src/app/api/auth/callback/google/route.ts redirects with
  // ?error=<code> on failure. Most common live event is `oauth_exchange_failed`
  // (PKCE verifier missing/expired — typically a Safari ITP edge or a multi-tab
  // flow). Friendly retry-friendly copy beats a blank screen.
  switch (code) {
    case "oauth_missing_code":
      return "تعذر إكمال تسجيل الدخول بحساب جوجل (كود الإذن غير موجود). حاول مرة أخرى.";
    case "oauth_exchange_failed":
      return "انتهت صلاحية محاولة تسجيل الدخول. اضغط على \"الدخول بحساب جوجل\" مرة أخرى من نفس المتصفح والنافذة.";
    case "oauth_no_user":
      return "لم نتمكن من قراءة بيانات حسابك بعد تسجيل الدخول. حاول مرة أخرى أو راسل الدعم.";
    case "oauth_unexpected":
      return "حدث خطأ غير متوقع أثناء تسجيل الدخول بحساب جوجل. حاول مرة أخرى.";
    default:
      return "تعذر تسجيل الدخول بحساب جوجل. حاول مرة أخرى.";
  }
}

export function LoginForm() {
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect") ?? "";
  const justRegistered = searchParams.get("registered") === "true";
  const oauthError = oauthErrorMessage(searchParams.get("error"));

  const [showPassword, setShowPassword] = useState(false);
  const [state, formAction, pending] = useActionState(
    login,
    {},
  );

  return (
    <>
      <h2 className="font-display mb-1 text-2xl font-bold leading-tight">تسجيل الدخول</h2>
      <p className="mb-6 text-sm text-muted">Sign in to your account</p>

      {/* Static URL-param-derived banners use direct role/aria so screen
          readers announce them on first paint. ActionFeedback handles the
          dynamic state.error case (which lands after form submission) and
          already wires role="alert" + aria-atomic correctly. */}
      {justRegistered && (
        <div
          role="status"
          aria-atomic="true"
          className="mb-4 rounded-lg glass-success p-3 text-sm text-success"
        >
          تم إنشاء الحساب بنجاح — سجّل دخولك الآن
        </div>
      )}

      <ActionFeedback state={state} />

      {oauthError && !state.error && (
        <div
          role="alert"
          aria-atomic="true"
          className="mb-4 rounded-lg glass-danger p-3 text-sm text-error"
        >
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
          <label htmlFor="email" className="mb-1.5 block">
            <span className="block text-sm font-medium">البريد الإلكتروني</span>
            <span className="block text-[11px] uppercase tracking-wider text-muted-light">Email</span>
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
          <div className="mb-1.5 flex items-end justify-between gap-3">
            <label htmlFor="password" className="block">
              <span className="block text-sm font-medium">كلمة المرور</span>
              <span className="block text-[11px] uppercase tracking-wider text-muted-light">Password</span>
            </label>
            <Link
              href="/forgot-password"
              className="shrink-0 text-xs text-gold hover:text-gold-hover"
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
          className="flex w-full items-center justify-center gap-2 rounded-full glass-gold glass-pill py-2.5 font-semibold text-background transition-colors hover:bg-primary-hover disabled:opacity-50"
        >
          {pending ? (
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-background/30 border-t-background" />
          ) : (
            <>
              <LogIn size={18} aria-hidden="true" />
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
